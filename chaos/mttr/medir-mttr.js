/**
 * Medidor de MTTR (Mean Time To Recovery) — Fase 4.
 * --------------------------------------------------------------------------
 * Orquestra um experimento de caos controlado e calcula o MTTR:
 *
 *   1) Baseline: sonda /api/v1/checkout e confirma que está saudável.
 *   2) Falha:    injeta o tóxico "Gateway Lento" (+5000ms) via Toxiproxy.
 *   3) Detecção: marca t_degraded = 1ª violação de SLO (erro ou p > limite).
 *   4) Reparo:   após `--falha-ms`, remove o tóxico (mitigação).
 *   5) Recupera: marca t_recovered = 1ª janela saudável sustentada.
 *
 *   MTTR (recuperação)        = t_recovered - t_reparo
 *   Tempo de detecção (MTTD)  = t_degraded  - t_falha
 *   Duração total do incidente= t_recovered - t_falha
 *
 * Sonda em paralelo, então mede a resiliência do serviço (timeout/breaker),
 * não a do gateway.
 *
 * Injeção da falha (duas opções):
 *   - Padrão: via /admin/latencia do gateway externo (não precisa de Docker).
 *   - `--toxiproxy`: via Toxiproxy (precisa do proxy criado previamente).
 *
 * Uso:
 *   node chaos/mttr/medir-mttr.js                 # toggle de latência (sem Docker)
 *   node chaos/mttr/medir-mttr.js --toxiproxy     # via Toxiproxy
 *   node chaos/mttr/medir-mttr.js --falha-ms 15000 --limite-ms 5000
 */
const toxics = require('../toxiproxy/toxics');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const GW_ADMIN = process.env.GW_ADMIN || 'http://localhost:4000';

function arg(nome, padrao) {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : padrao;
}

const LIMITE_MS = Number(arg('limite-ms', 5000)); // SLO de latência
const FALHA_MS = Number(arg('falha-ms', 15000)); // quanto tempo a falha fica ativa
const INTERVALO_MS = Number(arg('intervalo-ms', 500));
const JANELA_SAUDAVEL = 3; // sondagens boas consecutivas para declarar recuperação
const USAR_TOXIPROXY = process.argv.includes('--toxiproxy');

const cartao = { numero: 'TEST-CARD', validade: '12/2028', cvv: '000' };

async function injetarFalha() {
  if (USAR_TOXIPROXY) return toxics.gatewayLento(5000);
  return fetch(`${GW_ADMIN}/admin/latencia`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ms: 5000 })
  });
}

async function repararFalha() {
  if (USAR_TOXIPROXY) return toxics.limpar();
  return fetch(`${GW_ADMIN}/admin/latencia`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ms: 300 })
  });
}

async function sondar() {
  const inicio = Date.now();
  try {
    const resp = await fetch(`${BASE_URL}/api/v1/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clienteEmail: 'sonda@email.com', valor: 150, cartao })
    });
    const ms = Date.now() - inicio;
    const ok = resp.status === 200 && ms <= LIMITE_MS;
    return { ok, ms, status: resp.status };
  } catch (e) {
    return { ok: false, ms: Date.now() - inicio, status: 0, erro: e.message };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const linha = [];
  const t0 = Date.now();
  const rel = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

  let tFalha = null;
  let tDegraded = null;
  let tReparo = null;
  let tRecovered = null;
  let boasSeguidas = 0;
  let toxicoAtivo = false;
  let reparado = false;

  console.log(`[MTTR] Iniciando experimento contra ${BASE_URL}`);
  console.log(`[MTTR] SLO de latência: ${LIMITE_MS}ms | tóxico ativo por ${FALHA_MS}ms\n`);

  // dispara a injeção e o reparo no tempo certo, sem bloquear a sondagem.
  const orquestrar = (async () => {
    await sleep(3000); // baseline
    await injetarFalha().catch((e) =>
      console.warn(`[MTTR] aviso: não consegui injetar a falha (${e.message})`)
    );
    tFalha = Date.now();
    toxicoAtivo = true;
    console.log(`[${rel()}] >>> FALHA INJETADA: Gateway Lento (+5000ms)`);

    await sleep(FALHA_MS);
    await repararFalha().catch(() => {});
    tReparo = Date.now();
    reparado = true;
    toxicoAtivo = false;
    console.log(`[${rel()}] >>> REPARO APLICADO: tóxico removido`);
  })();

  const duracaoTotal = 3000 + FALHA_MS + 20000;
  while (Date.now() - t0 < duracaoTotal) {
    const s = await sondar();
    linha.push({ t: rel(), ...s });
    const tag = s.ok ? 'OK ' : 'FAIL';
    console.log(`[${rel()}] ${tag} status=${s.status} ${s.ms}ms${s.erro ? ' ' + s.erro : ''}`);

    if (toxicoAtivo && !s.ok && tDegraded === null) {
      tDegraded = Date.now();
      console.log(`[${rel()}] *** DEGRADAÇÃO DETECTADA (1ª violação de SLO)`);
    }

    if (reparado) {
      boasSeguidas = s.ok ? boasSeguidas + 1 : 0;
      if (boasSeguidas >= JANELA_SAUDAVEL && tRecovered === null) {
        tRecovered = Date.now();
        console.log(`[${rel()}] *** RECUPERAÇÃO CONFIRMADA (${JANELA_SAUDAVEL} sondas boas seguidas)`);
        break;
      }
    }
    await sleep(INTERVALO_MS);
  }

  await orquestrar;

  const seg = (a, b) => (a && b ? ((b - a) / 1000).toFixed(1) + 's' : 'n/d');
  console.log('\n──────────── RELATÓRIO DE MTTR ────────────');
  console.log(`MTTD (detecção)            : ${seg(tFalha, tDegraded)}`);
  console.log(`MTTR (recuperação)         : ${seg(tReparo, tRecovered)}`);
  console.log(`Duração total do incidente : ${seg(tFalha, tRecovered)}`);
  console.log('────────────────────────────────────────────');

  const totalSondas = linha.length;
  const falhas = linha.filter((l) => !l.ok).length;
  console.log(`Sondas: ${totalSondas} | falhas: ${falhas} | taxa de erro: ${((falhas / totalSondas) * 100).toFixed(1)}%`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
