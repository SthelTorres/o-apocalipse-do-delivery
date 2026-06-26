/**
 * Controle do Toxiproxy via API HTTP (porta 8474).
 * --------------------------------------------------------------------------
 * Cria/gerencia o proxy "gateway_pagamento" e injeta/remove os tóxicos do
 * enunciado. Usado tanto via linha de comando quanto importado pelo medidor
 * de MTTR.
 *
 * Topologia:
 *   checkout (Node)  →  Toxiproxy listen :21000  →  gateway-externo :4000
 *
 * Comandos:
 *   node chaos/toxiproxy/toxics.js setup          # cria o proxy
 *   node chaos/toxiproxy/toxics.js gateway-lento   # +5000ms de latência (RN: Gateway Lento)
 *   node chaos/toxiproxy/toxics.js queda           # derruba o proxy (timeout total)
 *   node chaos/toxiproxy/toxics.js limpar          # remove tóxicos / restabelece
 *   node chaos/toxiproxy/toxics.js status
 */
const TOXIPROXY_API = process.env.TOXIPROXY_API || 'http://localhost:8474';
const PROXY_NOME = 'gateway_pagamento';

// host visível pelo container do Toxiproxy para alcançar o gateway no host.
const UPSTREAM = process.env.GATEWAY_UPSTREAM || 'host.docker.internal:4000';
const LISTEN = process.env.PROXY_LISTEN || '0.0.0.0:21000';

async function api(metodo, caminho, corpo) {
  const resp = await fetch(`${TOXIPROXY_API}${caminho}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined
  });
  if (!resp.ok && resp.status !== 404) {
    throw new Error(`Toxiproxy ${metodo} ${caminho} -> HTTP ${resp.status}: ${await resp.text()}`);
  }
  return resp.status === 204 ? null : resp.json().catch(() => null);
}

async function setup() {
  await api('DELETE', `/proxies/${PROXY_NOME}`).catch(() => {});
  await api('POST', '/proxies', {
    name: PROXY_NOME,
    listen: LISTEN,
    upstream: UPSTREAM,
    enabled: true
  });
  console.log(`[toxiproxy] proxy '${PROXY_NOME}' criado: ${LISTEN} -> ${UPSTREAM}`);
}

// Cenário "Gateway Lento": +5000ms de latência no fluxo downstream.
async function gatewayLento(latencia = 5000) {
  await api('POST', `/proxies/${PROXY_NOME}/toxics`, {
    name: 'latencia_gateway',
    type: 'latency',
    stream: 'downstream',
    toxicity: 1.0,
    attributes: { latency: latencia, jitter: 0 }
  }).catch(async (e) => {
    // se já existe, atualiza
    await api('POST', `/proxies/${PROXY_NOME}/toxics/latencia_gateway`, {
      attributes: { latency: latencia, jitter: 0 }
    });
  });
  console.log(`[toxiproxy] TOXIC injetado: +${latencia}ms de latência no gateway`);
}

// Queda total: desabilita o proxy (todas as conexões falham → timeout/recusa).
async function queda() {
  await api('POST', `/proxies/${PROXY_NOME}`, { enabled: false });
  console.log('[toxiproxy] proxy DESABILITADO (queda total do gateway)');
}

async function limpar() {
  await api('DELETE', `/proxies/${PROXY_NOME}/toxics/latencia_gateway`).catch(() => {});
  await api('POST', `/proxies/${PROXY_NOME}`, { enabled: true });
  console.log('[toxiproxy] tóxicos removidos e proxy reabilitado (recuperação)');
}

async function status() {
  const proxy = await api('GET', `/proxies/${PROXY_NOME}`);
  console.log(JSON.stringify(proxy, null, 2));
}

const acoes = { setup, 'gateway-lento': () => gatewayLento(), queda, limpar, status };

if (require.main === module) {
  const acao = process.argv[2];
  const fn = acoes[acao];
  if (!fn) {
    console.error(`Ação desconhecida: ${acao}. Use: ${Object.keys(acoes).join(' | ')}`);
    process.exit(1);
  }
  fn().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}

module.exports = { setup, gatewayLento, queda, limpar, status, PROXY_NOME, TOXIPROXY_API };
