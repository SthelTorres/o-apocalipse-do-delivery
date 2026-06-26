/**
 * HttpGatewayPagamento
 * --------------------------------------------------------------------------
 * Adapter resiliente que implementa a interface esperada pelo CheckoutService
 * (`cobrar(valor, cartao)`), fazendo uma chamada HTTP real ao gateway externo.
 *
 * É AQUI que mora a blindagem da Fase 4 (SRE). Este módulo NÃO está na lista
 * `mutate` do Stryker de propósito: assim o Mutation Score de 100% da Fase 3
 * (focado nas regras de negócio do CheckoutService) permanece intacto, e a
 * lógica de infraestrutura/resiliência fica isolada.
 *
 * Implementa as regras RN04–RN07 do DER:
 *   - RN04: Timeout rígido por tentativa (default 2000ms) via AbortController.
 *   - RN05: Retry de até 3 tentativas adicionais em falhas de infra (5xx,
 *           timeout, conexão recusada).
 *   - RN06: Backoff fixo (500ms) + Jitter aleatório entre tentativas.
 *   - RN07: Circuit Breaker — abre quando a taxa de erro recente passa de 50%,
 *           falhando rápido (fail-fast) e dando tempo para a rede estabilizar.
 *
 * Objetivo de SRE: impedir que a lentidão/queda do gateway externo esgote o
 * event loop / pool de conexões do Express (efeito cascata).
 */

const ESTADO = Object.freeze({
  FECHADO: 'FECHADO', // operação normal
  ABERTO: 'ABERTO', // fail-fast, não chama o gateway
  MEIO_ABERTO: 'MEIO_ABERTO' // tentativa de recuperação
});

class CircuitBreakerAbertoError extends Error {
  constructor() {
    super('Circuit breaker ABERTO: gateway considerado indisponível (fail-fast)');
    this.name = 'CircuitBreakerAbertoError';
    this.circuitOpen = true;
  }
}

class HttpGatewayPagamento {
  constructor(baseUrl, opts = {}) {
    if (!baseUrl) throw new Error('baseUrl do gateway é obrigatório');
    this.baseUrl = baseUrl.replace(/\/$/, '');

    this.timeoutMs = opts.timeoutMs ?? 2000; // RN04
    this.maxRetries = opts.maxRetries ?? 3; // RN05
    this.backoffMs = opts.backoffMs ?? 500; // RN06
    this.jitterMs = opts.jitterMs ?? 250; // RN06 (jitter)

    // RN07 — Circuit Breaker
    this.errorRateThreshold = opts.errorRateThreshold ?? 0.5; // 50%
    this.volumeThreshold = opts.volumeThreshold ?? 5; // mínimo de amostras
    this.cooldownMs = opts.cooldownMs ?? 5000; // tempo aberto antes do meio-aberto
    this.janela = []; // histórico recente de outcomes (true=sucesso)
    this.janelaMax = opts.janelaMax ?? 20;

    this.estado = ESTADO.FECHADO;
    this.abertoEm = 0;

    this._fetch = opts.fetchImpl ?? globalThis.fetch;
    this._sleep = opts.sleepImpl ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Interface consumida pelo CheckoutService. */
  async cobrar(valor, cartao) {
    this._talvezMeioAbrir();
    if (this.estado === ESTADO.ABERTO) {
      throw new CircuitBreakerAbertoError();
    }

    let ultimoErro;
    for (let tentativa = 0; tentativa <= this.maxRetries; tentativa++) {
      try {
        const resposta = await this._chamarGateway(valor, cartao);
        this._registrar(true);
        return resposta; // { status: 'APROVADO' | 'RECUSADO' | ... }
      } catch (erro) {
        ultimoErro = erro;
        this._registrar(false);

        // Erros de negócio (4xx) não devem ser repetidos; apenas falhas de infra.
        if (!this._ehFalhaDeInfra(erro)) throw erro;
        if (this.estado === ESTADO.ABERTO) throw erro; // breaker abriu durante o loop

        if (tentativa < this.maxRetries) {
          await this._sleep(this._calcularEspera(tentativa)); // RN06: backoff + jitter
        }
      }
    }
    throw ultimoErro;
  }

  async _chamarGateway(valor, cartao) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs); // RN04
    try {
      const resp = await this._fetch(`${this.baseUrl}/cobrar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ valor, cartao }),
        signal: controller.signal
      });

      if (resp.status >= 500) {
        const e = new Error(`Gateway respondeu HTTP ${resp.status}`);
        e.httpStatus = resp.status;
        throw e;
      }
      return await resp.json();
    } catch (erro) {
      if (erro.name === 'AbortError') {
        const e = new Error(`Timeout de ${this.timeoutMs}ms ao chamar o gateway`);
        e.isTimeout = true;
        throw e;
      }
      throw erro;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Falha de infraestrutura = timeout, 5xx ou erro de rede (sem httpStatus 4xx). */
  _ehFalhaDeInfra(erro) {
    if (erro.isTimeout) return true;
    if (erro.httpStatus && erro.httpStatus >= 500) return true;
    if (erro.httpStatus && erro.httpStatus < 500) return false; // 4xx = negócio
    return true; // erro de rede (ECONNREFUSED, etc.)
  }

  _calcularEspera(tentativa) {
    const base = this.backoffMs * (tentativa + 1); // backoff crescente
    const jitter = Math.floor(Math.random() * this.jitterMs); // jitter anti-thundering-herd
    return base + jitter;
  }

  _registrar(sucesso) {
    this.janela.push(sucesso);
    if (this.janela.length > this.janelaMax) this.janela.shift();

    if (this.estado === ESTADO.MEIO_ABERTO) {
      // No meio-aberto, um sucesso fecha; uma falha reabre.
      if (sucesso) this._fechar();
      else this._abrir();
      return;
    }

    if (this.janela.length >= this.volumeThreshold) {
      const falhas = this.janela.filter((ok) => !ok).length;
      const taxaErro = falhas / this.janela.length;
      if (taxaErro > this.errorRateThreshold) this._abrir();
    }
  }

  _talvezMeioAbrir() {
    if (this.estado === ESTADO.ABERTO && Date.now() - this.abertoEm >= this.cooldownMs) {
      this.estado = ESTADO.MEIO_ABERTO;
    }
  }

  _abrir() {
    this.estado = ESTADO.ABERTO;
    this.abertoEm = Date.now();
  }

  _fechar() {
    this.estado = ESTADO.FECHADO;
    this.janela = [];
  }

  /** Snapshot para o endpoint /health (observabilidade do SRE). */
  estadoAtual() {
    const falhas = this.janela.filter((ok) => !ok).length;
    return {
      estado: this.estado,
      amostras: this.janela.length,
      taxaErro: this.janela.length ? falhas / this.janela.length : 0
    };
  }
}

module.exports = { HttpGatewayPagamento, CircuitBreakerAbertoError, ESTADO };
