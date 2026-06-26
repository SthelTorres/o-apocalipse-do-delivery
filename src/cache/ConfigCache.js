/**
 * ConfigCache — cache de configuração com proteção contra Thundering Herd.
 * --------------------------------------------------------------------------
 * Modela o cenário de caos #1 do enunciado: quando o nó de cache é esvaziado
 * abruptamente (flush) e 10.000 requisições chegam simultaneamente, todas
 * sofrem cache-miss ao mesmo tempo e tentam reabastecer a partir do banco —
 * a "manada estourada" (Thundering Herd) que pode derrubar o DB.
 *
 * Proteções aplicadas:
 *   - Single-flight (coalescing): apenas UMA recarga vai ao banco por vez;
 *     todas as outras requisições concorrentes aguardam a mesma Promise.
 *   - Backoff + Jitter: se a recarga falhar, novas tentativas são espaçadas
 *     com atraso aleatório, evitando sincronizar as retentativas.
 *
 * Assim, sob 10.000 requisições concorrentes após um flush, o "banco" recebe
 * apenas 1 leitura — comprovando a degradação graciosa.
 */
class ConfigCache {
  constructor(carregarDoBanco, opts = {}) {
    this._carregarDoBanco = carregarDoBanco; // simula a leitura lenta do DB
    this.ttlMs = opts.ttlMs ?? 30000;
    this.maxRetries = opts.maxRetries ?? 3;
    this.backoffMs = opts.backoffMs ?? 200;
    this.jitterMs = opts.jitterMs ?? 200;
    this._sleep = opts.sleepImpl ?? ((ms) => new Promise((r) => setTimeout(r, ms)));

    this._valor = null;
    this._expiraEm = 0;
    this._recargaEmAndamento = null; // Promise compartilhada (single-flight)

    // Métricas para provar a proteção contra a manada.
    this.metricas = { hits: 0, misses: 0, leiturasNoBanco: 0, coalescidas: 0 };
  }

  async get() {
    if (this._valor !== null && Date.now() < this._expiraEm) {
      this.metricas.hits++;
      return this._valor;
    }
    this.metricas.misses++;

    // Single-flight: se já há uma recarga em voo, todos aguardam a MESMA Promise.
    if (this._recargaEmAndamento) {
      this.metricas.coalescidas++;
      return this._recargaEmAndamento;
    }

    this._recargaEmAndamento = this._recarregarComResiliencia()
      .then((valor) => {
        this._valor = valor;
        this._expiraEm = Date.now() + this.ttlMs;
        return valor;
      })
      .finally(() => {
        this._recargaEmAndamento = null;
      });

    return this._recargaEmAndamento;
  }

  async _recarregarComResiliencia() {
    let ultimoErro;
    for (let tentativa = 0; tentativa <= this.maxRetries; tentativa++) {
      try {
        this.metricas.leiturasNoBanco++;
        return await this._carregarDoBanco();
      } catch (erro) {
        ultimoErro = erro;
        if (tentativa < this.maxRetries) {
          const espera = this.backoffMs * (tentativa + 1) + Math.floor(Math.random() * this.jitterMs);
          await this._sleep(espera);
        }
      }
    }
    throw ultimoErro;
  }

  flush() {
    this._valor = null;
    this._expiraEm = 0;
  }

  snapshot() {
    return { ...this.metricas, temValor: this._valor !== null };
  }
}

module.exports = { ConfigCache };
