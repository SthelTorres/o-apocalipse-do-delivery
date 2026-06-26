/**
 * Cenário de Caos #1 — Thundering Herd (Manada Estourada) — k6.
 * --------------------------------------------------------------------------
 * Dá um flush abrupto no cache e dispara ~10.000 requisições praticamente
 * simultâneas, todas sofrendo cache-miss ao mesmo tempo. Avalia se o banco
 * sobrevive graças ao Single-flight + Backoff/Jitter implementados no
 * ConfigCache (apenas 1 leitura no "banco" mesmo sob a manada).
 *
 * SLO sob estresse: taxa de erro < 5% e p95 < 5000ms.
 *
 * Execução:
 *   k6 run chaos/k6/thundering-herd.js
 *
 * Dica: antes do teste, observe GET /health para ver cache.leiturasNoBanco.
 * Depois do teste, observe novamente — deve crescer pouquíssimo (não ~10.000).
 */
import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import exec from 'k6/execution';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const flushes = new Counter('cache_flushes');

export const options = {
  scenarios: {
    // 10.000 iterações disparadas o mais rápido possível com alta concorrência.
    manada: {
      executor: 'shared-iterations',
      vus: 500,
      iterations: 10000,
      maxDuration: '2m'
    }
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<5000']
  }
};

const cartao = { numero: '4111111111111111', validade: '12/2028', cvv: '123' };

// Esvazia o cache UMA vez, no início, para forçar a manada de cache-miss.
export function setup() {
  const r = http.post(`${BASE_URL}/api/v1/cache/flush`);
  return { flushOk: r.status === 200 };
}

export default function () {
  // O primeiro VU reforça o flush para garantir a colisão de misses.
  if (exec.scenario.iterationInTest === 0) {
    http.post(`${BASE_URL}/api/v1/cache/flush`);
    flushes.add(1);
  }

  const payload = JSON.stringify({
    clienteEmail: `cliente${__VU}@email.com`,
    valor: 150.0,
    cartao
  });

  const res = http.post(`${BASE_URL}/api/v1/checkout`, payload, {
    headers: { 'Content-Type': 'application/json' }
  });

  check(res, {
    'sobreviveu (status < 500)': (r) => r.status < 500
  });
}
