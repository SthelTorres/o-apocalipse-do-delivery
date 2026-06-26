# Fase 4 — Caos & SRE (k6 + Toxiproxy)

Artefatos de Engenharia do Caos e testes de desempenho. Documento completo do
experimento em [`../docs/relatorio-fases.md`](../docs/relatorio-fases.md#fase-4--engenharia-do-caos-e-performance-sre).

## Estrutura

```
chaos/
├── gateway-externo.js        # mock HTTP do gateway bancário (porta 4000) + /admin/latencia
├── smoke-resiliencia.js      # prova local (Node puro) do breaker + single-flight
├── orquestra-caos-demo.js    # injeta/remove latência no platô (alternativa ao Toxiproxy sem Docker)
├── toxiproxy/
│   ├── docker-compose.yml     # serviço Toxiproxy
│   └── toxics.js              # cria proxy e injeta/remove tóxicos via API
├── k6/
│   ├── load-test.js           # carga Black Friday completa (~4min) + SLOs
│   ├── demo.js                # versão curta (~100s) usada para gerar os relatórios
│   └── thundering-herd.js     # 10.000 requisições + flush de cache
└── mttr/
    └── medir-mttr.js          # mede MTTD / MTTR / duração do incidente
```

Relatórios já gerados ficam em `reports/k6/` (`relatorio-baseline.html`, `relatorio-caos.html`).

## Pré-requisitos

- **Node.js 18+** (já usado pelo projeto) — possui `fetch` e `AbortController` nativos.
- **k6** — https://grafana.com/docs/k6/latest/set-up/install-k6/
  - Windows: `winget install k6 --source winget` ou `choco install k6`
- **Docker** (para o Toxiproxy) — https://docs.docker.com/get-docker/
  - Alternativa sem Docker: baixar o binário `toxiproxy-server` do
    [releases do Toxiproxy](https://github.com/Shopify/toxiproxy/releases).

## Smoke test sem dependências externas

Prova a lógica de resiliência (circuit breaker, timeout, retry, single-flight)
sem Docker nem k6:

```bash
node chaos/smoke-resiliencia.js
```

## Rodar o k6 SEM Docker (injeção via /admin/latencia)

Forma usada para gerar os relatórios deste repositório (não precisa de Toxiproxy):

```bash
# Terminal A — gateway externo
node chaos/gateway-externo.js

# Terminal B — checkout em modo caos (breaker ágil para a demo)
$env:GATEWAY_URL="http://localhost:4000"; $env:GATEWAY_TIMEOUT_MS="1500"; $env:GATEWAY_MAX_RETRIES="1"; node src/server.js

# Terminal C — baseline (gera reports/k6/relatorio-baseline.html)
$env:K6_WEB_DASHBOARD="true"; $env:K6_WEB_DASHBOARD_EXPORT="reports/k6/relatorio-baseline.html"
k6 run chaos/k6/demo.js --summary-export reports/k6/resumo-baseline.json

# Terminal C — caos: dispare o orquestrador (injeta +5000ms no platô) e o k6 juntos
node chaos/orquestra-caos-demo.js          # em paralelo
$env:K6_WEB_DASHBOARD_EXPORT="reports/k6/relatorio-caos.html"
k6 run chaos/k6/demo.js --summary-export reports/k6/resumo-caos.json
```

## Scripts npm úteis

```bash
npm test        # Fase 3 — Jest (unitário + cobertura)
npm run bdd     # Fase 2 — Cucumber (especificação viva)
npm run mutation# Fase 3 — Stryker (mutation score)
```

Para o roteiro completo do experimento de caos, veja a seção 7 da Fase 4 em
[`../docs/relatorio-fases.md`](../docs/relatorio-fases.md#fase-4--engenharia-do-caos-e-performance-sre).
