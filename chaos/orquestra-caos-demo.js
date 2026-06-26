/**
 * Orquestrador de caos para a demo do k6 (alternativa ao Toxiproxy sem Docker).
 * Durante o platô do teste de carga, injeta +5000ms de latência no gateway
 * externo via /admin/latencia e depois restaura, para evidenciar a degradação
 * graciosa e a recuperação (MTTR) nos gráficos do k6.
 */
const GW = process.env.GW_ADMIN || 'http://localhost:4000';
const INJETAR_EM = Number(process.env.INJETAR_EM_MS) || 45000;
const REMOVER_EM = Number(process.env.REMOVER_EM_MS) || 75000;
const LATENCIA = Number(process.env.LATENCIA_MS) || 5000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const setLatencia = async (ms) => {
  await fetch(`${GW}/admin/latencia`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ms })
  });
  console.log(`[caos] latência do gateway -> ${ms}ms (t=${Date.now()})`);
};

(async () => {
  console.log(`[caos] injetar em ${INJETAR_EM}ms, remover em ${REMOVER_EM}ms`);
  await sleep(INJETAR_EM);
  await setLatencia(LATENCIA); // >>> Gateway Lento
  await sleep(REMOVER_EM - INJETAR_EM);
  await setLatencia(300); // <<< recuperação
  console.log('[caos] ciclo concluído');
})();
