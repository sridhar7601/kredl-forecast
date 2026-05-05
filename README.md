# SuryaVayu AI — Renewable Generation Forecasting for KREDL/KSPDCL

> **PanIIT AI for Bharat Hackathon — Theme 10**  
> AI-powered day-ahead and intraday renewable generation forecasting for Karnataka's solar and wind fleet.

---

## What it does

SuryaVayu AI helps KREDL/KSPDCL grid operators answer three questions every morning:

1. **How much power** will each plant and cluster produce tomorrow — and in what scenarios (base / optimistic / pessimistic)?
2. **Why** did the forecast change — which factor (cloud cover, temperature, wind) is driving it?
3. **What should we do** — pre-schedule thermal backup, flag curtailment risk, retrain the model?

**Powered by Azure GPT-4.1** for operational narration, grounded in a deterministic physics-based forecast engine so no numbers are hallucinated.

---

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | 18+ |
| npm | 9+ |

No Python. No Docker. No external database. SQLite is bundled.

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Create `.env.local` in the project root:

```env
# Required — Azure OpenAI (for AI briefing, alert explanations, narration)
AZURE_OPENAI_API_KEY=your_azure_openai_key
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/openai/deployments/your-deployment/chat/completions?api-version=2025-01-01-preview

# Optional — standard OpenAI fallback if Azure not available
# OPENAI_API_KEY=sk-...
```

> **Without API keys:** The app runs fully — AI cards show deterministic fallback text. All forecasting, charts, alerts, and accuracy metrics work offline.

### 3. Set up the database

```bash
npx prisma generate
npx prisma migrate dev --name init
```

### 4. Fetch real weather data (recommended)

Fetches 90 days of real hourly weather from [Open-Meteo](https://open-meteo.com) (free, no API key) for all 9 plant locations in Karnataka. Cached to `data/real-weather/` so demo works offline after first run.

```bash
npm run fetch-weather
```

> Skip this step if offline — seed will use synthetic weather fallback.

### 5. Seed demo data

```bash
npm run seed
```

Seeds:
- 9 plants (6 solar, 3 wind) across Karnataka — Pavagada, Gadag, Koppal, Tumakuru, Chitradurga, Ballari
- 90 days × 24h hourly generation + weather per plant (real-weather-driven)
- Forecasts for 3 horizons (6H / Day-Ahead / Week) × 3 scenarios (Base / Optimistic / Pessimistic)
- Cluster-level aggregates by district + plant type
- MAPE / RMSE / MBE accuracy records
- Alert feed: ramp events, curtailment risk, model drift
- 3 model versions (`sv-0.1` → `sv-0.3`)

### 6. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## Full setup (one command)

```bash
npm install && npm run fetch-weather && npm run seed && npm run dev
```

---

## Key features

| Feature | Where |
|---------|-------|
| **AI Daily Briefing** (Azure GPT-4.1) | Dashboard — top card |
| **AI Alert Explanations** (Azure GPT-4.1) | Alerts page — each HIGH/CRITICAL alert |
| **AI Grid Analysis** (Azure GPT-4.1) | Plant detail → Forecast tab |
| **AI Model Report** (Azure GPT-4.1) | Models page — retrain analysis |
| Real weather data (Open-Meteo) | Weather tab — data source badge |
| Horizon selector (6H / Day-Ahead / Week) | Plant detail → Forecast tab |
| Scenario comparison (Base / Optimistic / Pessimistic) | Forecast chart |
| Attribution chart — why this forecast? | Forecast tab — stacked bar |
| Cluster-level forecasts (district + type) | /clusters |
| Baseline comparison vs persistence + seasonal-naive | Accuracy tab |
| Drift detector → retrain → auto-ack | Alerts + Models pages |
| Curtailment cost ₹ estimate (KREDL PPA rate) | History tab |
| CSV export (browser, no API) | Forecast tab — Download CSV |
| Dispatch recommendation | Dashboard |
| Plant map (Leaflet) | Dashboard |

---

## Available scripts

```bash
npm run dev               # Start dev server
npm run build             # Production build
npm run seed              # Seed demo data (uses cached real weather if available)
npm run fetch-weather     # Fetch real weather from Open-Meteo and cache to disk
npm run fetch-weather:force  # Force re-fetch even if cache exists
npm run seed:full         # fetch-weather + seed in one step
npm run typecheck         # TypeScript check
npm run lint              # ESLint
```

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, TypeScript) |
| Database | Prisma + SQLite |
| Charts | Tremor v3 |
| Map | Leaflet + react-leaflet |
| AI / LLM | Azure OpenAI GPT-4.1 (enterprise) |
| Weather | Open-Meteo API (free, no key) |
| Styling | Tailwind CSS v3 |
| Statistics | simple-statistics |

---

## Architecture

```
app/                    Next.js pages + API routes
├── page.tsx            Dashboard (AI briefing, clusters, dispatch card)
├── plants/[id]/        Plant detail (forecast, history, weather, accuracy, alerts)
├── clusters/           Cluster-level aggregate forecasts
├── alerts/             Grid alerts with AI explanations
└── models/             Model versioning + retrain + AI report

lib/
├── forecast.ts         Single feature-conditioned forecast engine (plantType as feature)
├── baselines.ts        Persistence + seasonal-naive baseline forecasters
├── cluster.ts          Cluster aggregation (sum-of-variances confidence bounds)
├── alerts.ts           Alert detection + drift detector
├── llm-narration.ts    Azure GPT-4.1 integration (cached, deterministic fallback)
└── weather-cache.ts    Open-Meteo cache reader

scripts/
├── fetch-real-weather.ts   Fetches real weather from Open-Meteo → data/real-weather/
├── generate-timeseries.ts  Weather-driven generation synthesis
└── seed-demo.ts            Full demo seed
```

---

## Forecast model

- **Single feature-conditioned model** — `plantType` is an input feature, not a model selector. One pipeline for all asset types.
- **Physics-based** — solar: irradiance → GHI → capacity factor; wind: wind speed → power curve
- **Attribution** — each forecast hour decomposed into: baseline + cloud penalty + temp derate + wind factor + scenario adjustment
- **No hosted ML dependency** — works fully offline; swap `forecastFeatures()` for any trained model output

### Accuracy (demo data)

| Metric | SuryaVayu | Persistence (t−24h) | Seasonal-naive (t−168h) |
|--------|-----------|---------------------|------------------------|
| MAPE | ~16% | ~58% | ~334% |
| Improvement | — | **−72%** | **−95%** |

---

## AI usage (Azure GPT-4.1)

All AI outputs are **grounded** — GPT-4.1 only describes numbers the physics model computed. No hallucinated MW values.

| Feature | Prompt structure |
|---------|-----------------|
| Daily Briefing | Fleet forecast + cluster highlight + thermal standby recommendation |
| Alert Explanation | Alert type + severity → plain-language meaning + dispatch action |
| Grid Analysis | PEAK / RISK / ACTION structured format for plant forecast |
| Model Report | MAPE comparison old vs new + deployment recommendation |

Responses cached to `data/llm-cache/` after first call — demo never breaks if network is down.

---

## Submission

- **Hackathon:** PanIIT AI for Bharat
- **Theme:** 10 — AI for Renewable Generation Forecasting (KREDL/KSPDCL)
- **Team:** Sridhar, Sruthi
