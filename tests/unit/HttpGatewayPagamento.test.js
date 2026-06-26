/**
 * Testes do adapter resiliente de gateway (Fase 4 / RN04–RN07).
 * Usa fetch e sleep injetados para ser determinístico e rápido.
 */
const {
  HttpGatewayPagamento,
  CircuitBreakerAbertoError,
  ESTADO
} = require('../../src/gateways/HttpGatewayPagamento');

const sleepFake = () => Promise.resolve(); // não espera de verdade

function respostaOk(body) {
  return { status: 200, json: async () => body };
}
function resposta5xx(status = 503) {
  return { status, json: async () => ({}) };
}

function novoGateway(fetchImpl, opts = {}) {
  return new HttpGatewayPagamento('http://fake-gateway', {
    timeoutMs: 30,
    maxRetries: 3,
    backoffMs: 1,
    jitterMs: 1,
    volumeThreshold: 3,
    cooldownMs: 20,
    fetchImpl,
    sleepImpl: sleepFake,
    ...opts
  });
}

describe('HttpGatewayPagamento — caminho feliz e negócio', () => {
  test('retorna APROVADO em chamada única quando o gateway responde 200', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(respostaOk({ status: 'APROVADO' }));
    const gw = novoGateway(fetchImpl);

    const r = await gw.cobrar(150, { numero: 'x' });

    expect(r).toEqual({ status: 'APROVADO' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(gw.estado).toBe(ESTADO.FECHADO);
  });

  test('envia valor e cartão no corpo da requisição', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(respostaOk({ status: 'APROVADO' }));
    const gw = novoGateway(fetchImpl);

    await gw.cobrar(99.9, { numero: '123' });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://fake-gateway/cobrar');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ valor: 99.9, cartao: { numero: '123' } });
  });

  test('retorna RECUSADO sem retry (falha de negócio, não de infra)', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(respostaOk({ status: 'RECUSADO' }));
    const gw = novoGateway(fetchImpl);

    const r = await gw.cobrar(150, {});

    expect(r).toEqual({ status: 'RECUSADO' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('HttpGatewayPagamento — RN05 retry em falha de infra', () => {
  test('faz retry em 5xx e recupera na tentativa seguinte', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(resposta5xx(503))
      .mockResolvedValueOnce(respostaOk({ status: 'APROVADO' }));
    const gw = novoGateway(fetchImpl);

    const r = await gw.cobrar(150, {});

    expect(r).toEqual({ status: 'APROVADO' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('esgota os retries e lança erro quando o 5xx persiste', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(resposta5xx(500));
    const gw = novoGateway(fetchImpl, { volumeThreshold: 99 }); // não abrir breaker aqui

    await expect(gw.cobrar(150, {})).rejects.toThrow(/HTTP 500/);
    expect(fetchImpl).toHaveBeenCalledTimes(4); // 1 + 3 retries
  });
});

describe('HttpGatewayPagamento — RN04 timeout', () => {
  test('aborta por timeout e trata como falha de infra (com retry)', async () => {
    const fetchImpl = jest.fn().mockImplementation((_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          const e = new Error('aborted');
          e.name = 'AbortError';
          reject(e);
        });
      })
    );
    const gw = novoGateway(fetchImpl, { timeoutMs: 15, volumeThreshold: 99 });

    await expect(gw.cobrar(150, {})).rejects.toThrow(/Timeout/);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });
});

describe('HttpGatewayPagamento — RN07 circuit breaker', () => {
  test('abre o breaker quando a taxa de erro passa de 50% e falha rápido', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(resposta5xx(500));
    const gw = novoGateway(fetchImpl, { maxRetries: 0, volumeThreshold: 3 });

    // 3 falhas seguidas → taxa de erro 100% → abre
    for (let i = 0; i < 3; i++) {
      await expect(gw.cobrar(150, {})).rejects.toBeDefined();
    }
    expect(gw.estado).toBe(ESTADO.ABERTO);

    const chamadasAntes = fetchImpl.mock.calls.length;
    await expect(gw.cobrar(150, {})).rejects.toBeInstanceOf(CircuitBreakerAbertoError);
    // fail-fast: NÃO chamou o gateway de novo
    expect(fetchImpl.mock.calls.length).toBe(chamadasAntes);
  });

  test('vai a MEIO_ABERTO após cooldown e FECHA ao primeiro sucesso', async () => {
    let saudavel = false;
    const fetchImpl = jest.fn().mockImplementation(() =>
      saudavel ? respostaOk({ status: 'APROVADO' }) : resposta5xx(500)
    );
    const gw = novoGateway(fetchImpl, { maxRetries: 0, volumeThreshold: 3, cooldownMs: 10 });

    for (let i = 0; i < 3; i++) {
      await expect(gw.cobrar(150, {})).rejects.toBeDefined();
    }
    expect(gw.estado).toBe(ESTADO.ABERTO);

    saudavel = true;
    await new Promise((r) => setTimeout(r, 15)); // passa o cooldown

    const r = await gw.cobrar(150, {});
    expect(r).toEqual({ status: 'APROVADO' });
    expect(gw.estado).toBe(ESTADO.FECHADO);
  });

  test('estadoAtual() expõe o snapshot para o /health', () => {
    const gw = novoGateway(jest.fn());
    const snap = gw.estadoAtual();
    expect(snap).toEqual({ estado: ESTADO.FECHADO, amostras: 0, taxaErro: 0 });
  });
});

describe('HttpGatewayPagamento — construtor', () => {
  test('lança erro se baseUrl não for informado', () => {
    expect(() => new HttpGatewayPagamento()).toThrow(/baseUrl/);
  });
});
