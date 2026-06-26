/**
 * Versão curta do teste de carga (≈100s) para gerar relatórios HTML com gráficos
 * de forma rápida na demonstração. Mesmos SLOs do load-test.js.
 *
 * Relatório com gráficos (dashboard nativo do k6):
 *   K6_WEB_DASHBOARD=true K6_WEB_DASHBOARD_EXPORT=reports/k6/relatorio.html \
 *     k6 run chaos/k6/demo.js
 */
import http from 'k6/http';
import { check } from 'k6';
import { Rate } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const erroNegocio = new Rate('erros_negocio');

export const options = {
  scenarios: {
    black_friday_curto: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 50 },   // ramp-up
        { duration: '20s', target: 150 },  // sobe para carga alta
        { duration: '40s', target: 150 },  // STEADY (injetar caos aqui)
        { duration: '20s', target: 0 }     // ramp-down
      ],
      gracefulRampDown: '5s'
    }
  },
  thresholds: {
    http_req_duration: ['p(95)<5000'],
    http_req_failed: ['rate<0.05'],
    erros_negocio: ['rate<0.05']
  }
};

const cartao = { numero: 'TEST-CARD', validade: '12/2028', cvv: '000' };

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

  const ok = check(res, { 'status 200': (r) => r.status === 200 });
  erroNegocio.add(!ok);
}
