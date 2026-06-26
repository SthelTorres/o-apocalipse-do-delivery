/**
 * Gateway de Pagamento EXTERNO (mock) — Fase 4.
 * --------------------------------------------------------------------------
 * Simula a API bancária parceira. Roda como um processo HTTP separado para
 * que o Toxiproxy possa se posicionar ENTRE o microsserviço de checkout e este
 * gateway, injetando latência (Gateway Lento, 5000ms) e quedas.
 *
 * Responde POST /cobrar com { status: 'APROVADO' } após ~300ms (latência base
 * "saudável", conforme o README do repositório base).
 *
 * Toggle de latência em runtime (alternativa ao Toxiproxy quando não há Docker):
 *   POST /admin/latencia { "ms": 5000 }   → injeta o "Gateway Lento"
 *   POST /admin/latencia { "ms": 300 }    → restaura a latência saudável
 *   GET  /admin/latencia                  → consulta a latência atual
 *
 * Uso:
 *   node chaos/gateway-externo.js            # porta 4000 (default)
 *   GATEWAY_PORT=4000 node chaos/gateway-externo.js
 */
const express = require('express');

const app = express();
app.use(express.json());

const LATENCIA_BASE_MS = Number(process.env.GATEWAY_LATENCIA_MS) || 300;
let latenciaAtual = LATENCIA_BASE_MS;

app.post('/cobrar', (req, res) => {
  const { valor } = req.body || {};
  setTimeout(() => {
    // Regra simples para permitir testar o caminho RECUSADO: valor negativo recusa.
    if (typeof valor === 'number' && valor < 0) {
      return res.status(200).json({ status: 'RECUSADO' });
    }
    res.status(200).json({ status: 'APROVADO', autorizacao: `AUTH-${Date.now()}` });
  }, latenciaAtual);
});

app.post('/admin/latencia', (req, res) => {
  const ms = Number(req.body?.ms);
  if (Number.isFinite(ms) && ms >= 0) {
    latenciaAtual = ms;
    console.log(`[gateway-externo] latência ajustada para ${latenciaAtual}ms`);
  }
  res.json({ latenciaAtual });
});

app.get('/admin/latencia', (req, res) => res.json({ latenciaAtual }));

app.get('/health', (req, res) =>
  res.json({ status: 'ok', servico: 'gateway-externo', latenciaAtual })
);

const PORT = Number(process.env.GATEWAY_PORT) || 4000;
app.listen(PORT, () =>
  console.log(`[gateway-externo] ouvindo na porta ${PORT} (latência base ${LATENCIA_BASE_MS}ms)`)
);
