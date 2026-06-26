/**
 * Smoke test determinístico (Node puro, sem docker/k6) que prova:
 *   1. Timeout + Retry + Circuit Breaker do HttpGatewayPagamento sob "Gateway Lento".
 *   2. Recuperação automática do breaker (ABERTO → MEIO_ABERTO → FECHADO).
 *   3. Single-flight do ConfigCache sob Thundering Herd (10.000 misses → 1 leitura no DB).
 *
 * Executar: node chaos/smoke-resiliencia.js
 */
const assert = require('assert');
const { HttpGatewayPagamento, CircuitBreakerAbertoError, ESTADO } =
  require('../src/gateways/HttpGatewayPagamento');
const { ConfigCache } = require('../src/cache/ConfigCache');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// fetch que NUNCA responde (simula gateway com +5000ms → estoura o timeout).
function fetchPendente(_url, { signal }) {
  return new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => {
      const e = new Error('aborted');
      e.name = 'AbortError';
      reject(e);
    });
  });
}

// fetch saudável que aprova rápido.
function fetchSaudavel() {
  return Promise.resolve({
    status: 200,
    json: async () => ({ status: 'APROVADO' })
  });
}

async function testeCircuitBreaker() {
  console.log('\n=== 1) Gateway Lento → Timeout/Retry/Circuit Breaker ===');
  let lento = true;
  const gw = new HttpGatewayPagamento('http://fake', {
    timeoutMs: 40,
    maxRetries: 1,
    backoffMs: 2,
    jitterMs: 2,
    volumeThreshold: 3,
    cooldownMs: 60,
    fetchImpl: (url, opts) => (lento ? fetchPendente(url, opts) : fetchSaudavel()),
    sleepImpl: sleep
  });

  // Várias cobranças sob gateway lento → todas falham por timeout.
  let timeouts = 0;
  let breakerFailFast = 0;
  for (let i = 0; i < 6; i++) {
    const t = Date.now();
    try {
      await gw.cobrar(150, {});
    } catch (e) {
      if (e instanceof CircuitBreakerAbertoError) {
        breakerFailFast++;
        assert.ok(Date.now() - t < 20, 'fail-fast deve ser quase instantâneo');
      } else {
        timeouts++;
      }
    }
  }
  assert.ok(timeouts >= 1, 'deve haver timeouts iniciais');
  assert.strictEqual(gw.estado, ESTADO.ABERTO, 'breaker deve estar ABERTO');
  assert.ok(breakerFailFast >= 1, 'breaker deve ter falhado rápido ao menos 1x');
  console.log(`OK  timeouts=${timeouts}, fail-fast(breaker aberto)=${breakerFailFast}, estado=${gw.estado}`);

  // Recuperação: gateway volta a responder + passou o cooldown.
  lento = false;
  await sleep(70);
  const resp = await gw.cobrar(150, {});
  assert.strictEqual(resp.status, 'APROVADO');
  assert.strictEqual(gw.estado, ESTADO.FECHADO, 'breaker deve FECHAR após sucesso no meio-aberto');
  console.log(`OK  recuperação: resposta=${resp.status}, estado=${gw.estado}`);
}

async function testeThunderingHerd() {
  console.log('\n=== 2) Thundering Herd → Single-flight protege o banco ===');
  let leiturasReais = 0;
  const cache = new ConfigCache(
    async () => {
      leiturasReais++;
      await sleep(50); // banco "lento"
      return { taxaServico: 0.05 };
    },
    { ttlMs: 30000 }
  );

  cache.flush(); // manada de cache-miss
  const N = 10000;
  const resultados = await Promise.all(Array.from({ length: N }, () => cache.get()));

  assert.strictEqual(resultados.length, N);
  assert.ok(resultados.every((r) => r && r.taxaServico === 0.05));
  assert.strictEqual(leiturasReais, 1, 'o banco deve ser lido apenas 1 vez sob a manada');
  console.log(`OK  ${N} requisições simultâneas → leiturasNoBanco=${leiturasReais} (coalescidas=${cache.metricas.coalescidas})`);
}

(async () => {
  await testeCircuitBreaker();
  await testeThunderingHerd();
  console.log('\n✅ Smoke de resiliência PASSOU — degradação graciosa comprovada localmente.');
})().catch((e) => {
  console.error('\n❌ FALHOU:', e.message);
  process.exit(1);
});
