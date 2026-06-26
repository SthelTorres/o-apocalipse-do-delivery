/**
 * Teste de Carga e Estresse — Black Friday (k6).
 * --------------------------------------------------------------------------
 * Padrão de volumetria: ramp-up → steady (platô) → ramp-down.
 *
 * SLI/SLO (thresholds rígidos do enunciado):
 *   - p95 da latência das requisições  < 5000ms   (http_req_duration)
 *   - taxa de erro                     < 5%        (http_req_failed)
 *
 * Durante o platô de carga máxima, execute o Toxiproxy para injetar o
 * "Gateway Lento" (+5000ms) e observe se o circuit breaker / timeout do
 * serviço mantém os SLOs (degradação graciosa) ou se a tela "fica vermelha".
 *
 * Execução:
 *   k6 run chaos/k6/load-test.js
 *   k6 run -e BASE_URL=http://localhost:3000 chaos/k6/load-test.js
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

const erroNegocio = new Rate('erros_negocio');
const latenciaCheckout = new Trend('latencia_checkout', true);

export const options = {
  scenarios: {
    black_friday: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 50 },   // ramp-up
        { duration: '1m', target: 200 },   // ramp-up para carga máxima
        { duration: '2m', target: 200 },   // STEADY (platô) — injete o toxic aqui
        { duration: '30s', target: 0 }     // ramp-down
      ],
      gracefulRampDown: '10s'
    }
  },
  thresholds: {
    // SLO de latência: 95% das requisições abaixo de 5s.
    http_req_duration: ['p(95)<5000'],
    // SLO de disponibilidade: menos de 5% de falhas HTTP.
    http_req_failed: ['rate<0.05'],
    erros_negocio: ['rate<0.05']
  }
};

const cartao = { numero: '4111111111111111', validade: '12/2028', cvv: '123' };

export default function () {
  const payload = JSON.stringify({
    clienteEmail: `cliente${__VU}@email.com`,
    valor: 150.0,
    cartao
  });

  const res = http.post(`${BASE_URL}/api/v1/checkout`, payload, {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'checkout' }
  });

  latenciaCheckout.add(res.timings.duration);
  const ok = check(res, {
    'status 200': (r) => r.status === 200,
    'pedido processado': (r) => {
      try {
        return JSON.parse(r.body).pedido?.status === 'PROCESSADO';
      } catch (_) {
        return false;
      }
    }
  });
  erroNegocio.add(!ok);

  sleep(Math.random() * 0.5);
}
