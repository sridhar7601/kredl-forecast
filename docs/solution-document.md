# SuryaVayu AI — Day-Ahead Renewable Generation Forecasting for KREDL/KSPDCL

**PanIIT AI for Bharat Hackathon — Theme 10 Submission**

---

## 1. Executive Summary

Karnataka has more than **15 GW of installed solar capacity** and a growing wind portfolio across the Pavagada, Koppal, and Gadag corridors. That generation is inherently variable — a passing cloud bank can drop solar output by 60% in an hour, and wind can ramp 40% of capacity within fifteen minutes. Grid operators at KREDL (Karnataka Renewable Energy Development Ltd) and KSPDCL need reliable **day-ahead and intraday forecasts** to schedule conventional generation, avoid curtailment, and manage reserve margins. Forecast accuracy in India today trails global benchmarks by 3–5 percentage points on MAPE, partly because most tools treat solar and wind uniformly and partly because they don't expose uncertainty in a way an operator can act on.

**SuryaVayu AI** is a renewable-generation forecasting platform built specifically for KREDL/KSPDCL operations. It produces three outputs per plant per horizon (day-ahead, intraday-six-hour, week) and per scenario (base, optimistic, pessimistic), with confidence bands that widen with horizon to give operators a usable uncertainty signal rather than false precision. A self-reporting accuracy tab (MAPE, RMSE, MBE) makes forecast quality a first-class citizen of the platform — operators can see at a glance whether the current model version is improving or drifting. An alerts engine fires on five operational patterns (steep ramps, curtailment risk, persistent under-forecast, persistent over-forecast, plant offline). Mock-AI by default — the forecast engine is deterministic pure JavaScript with zero Python dependencies, zero cloud cost, zero API key dependency.

---

## 2. Problem Deep Dive

### Pain points

- **Variability without actionable uncertainty.** Operators see a single forecast number per hour. They don't see how confident the model is, so they can't size reserves rationally. The result: reserves are over-allocated (wasting fuel) or under-allocated (risking curtailment).
- **No scenario thinking in the workflow.** Real operators reason in scenarios — what if a forecast cloud cover doesn't materialise? What if wind comes in stronger than expected? Existing tools force a single point estimate.
- **Forecast accuracy is opaque.** When a model degrades, nobody notices until a major scheduling miss. There's no operator-visible metric trend.
- **Curtailment is reactive.** Curtailment events get logged after the fact. The operator gets no advance warning that a forecast is heading into curtailment territory.

### Stakeholders

- **Primary:** KREDL and KSPDCL grid operators, day-ahead market schedulers, IPP (Independent Power Producer) plant operators submitting forecasts under PPA obligations.
- **Secondary:** Karnataka State Load Despatch Centre (KSLDC) for grid balancing, central renewable energy regulators (MNRE / CERC) for forecast quality compliance under DSM (Deviation Settlement Mechanism) rules.

### Regulatory & deployment context

CERC's Deviation Settlement Mechanism penalises generators (and pays them) based on the gap between scheduled and actual generation. Better forecast accuracy directly translates to fewer DSM penalties — typically a single percentage point of MAPE improvement is worth several lakhs per month for a 50 MW plant. The MNRE's Renewable Energy Management Centres (REMC) program mandates state-level forecast platforms; SuryaVayu AI is sized exactly for that REMC role at the Karnataka state level.

---

## 3. Solution Architecture

### System overview

SuryaVayu AI is one Next.js 15 application (App Router) combining the operator UI, REST-style JSON routes under `app/api/**`, and Prisma persistence. The forecast engine is pure TypeScript — `lib/forecast.ts` — with no Python sidecar. SQLite for the prototype; the schema migrates cleanly to PostgreSQL plus Timescale extension for production time-series scale.

### Operator user journey

1. **Grid control-room dashboard (`/`).** Tremor cards (Total Capacity MW, Current Output MW, Tomorrow Forecast MW, Open Alerts), AreaChart of network-wide actual-vs-forecast over the last 7 days, Leaflet map with plant markers colour-coded by status (active/maintenance/offline), recent-alerts feed.
2. **Plants list (`/plants`).** Filterable table by type / district / status with current MW, tomorrow forecast MW, and last 7-day MAPE per plant.
3. **Plant detail (`/plants/[id]`) — the money shot.** Five tabs: Forecast (horizon selector + scenario toggle group with three lines overlaid plus a confidence band), History (30-day generation + curtailment stacked), Weather (GHI / cloud cover / temperature / wind speed time series), Accuracy (MAPE/RMSE/MBE cards, daily MAPE bars, accuracy log), Alerts (plant-specific).
4. **Alerts (`/alerts`).** Grid-wide alerts table with severity / type filters and acknowledgement workflow.
5. **Models (`/models`).** Model version history, current active model card, "Retrain on latest data" button → mock retrain that bumps version and improves overall MAPE.

### Data model

`Plant` (type, capacity, location, status, commissioning date) with related `Generation` (actual MW, available MW, curtailed MW), `WeatherReading` (GHI, cloud cover, temperature, wind speed/direction, humidity), `Forecast` (horizon, scenario, JSON points array with timestamp / forecastMW / lower-upper bounds, model version, mean confidence), `ForecastAccuracy` (MAPE, RMSE, MBE, sample size), `Alert` (type, severity, evidence JSON, acknowledged flag), `ModelVersion` (versionTag, description, overall MAPE, active flag). All time-series tables indexed on `(plantId, timestamp)` for fast horizon queries.

### Forecast engine (`lib/forecast.ts`)

The differentiator is what's *not* in the engine: no Python, no Prophet, no neural network. The MVP uses a deterministic pure-TS approach that's fast, reproducible, and explainable.

**For solar plants:**

1. Build a 30-day diurnal profile — for each hour of the day, average that hour's output divided by capacity over the past 30 days, producing 24 normalised values between 0 and 1.
2. Apply weather adjustment per future timestamp: `forecastMW = diurnal[hour] × (1 − 0.6×cloudCover − 0.004×(temp−25)) × capacityMW × scenarioFactor`. The cloud-cover penalty is the dominant correction; temperature derating reflects the well-known efficiency drop of silicon panels above ~25°C.
3. Apply scenario multiplier: BASE × 1.0, OPTIMISTIC × 1.08, PESSIMISTIC × 0.88.
4. Confidence bounds widen with horizon: ±10% for day-ahead, ±15% for intraday-6h, ±25% for week-ahead. Wider bounds aren't a model weakness — they're an operator signal that uncertainty is genuinely higher at longer horizons.

**For wind plants:**

1. Power-curve function: zero output below cut-in (3 m/s), linear ramp to rated power at 12 m/s, flat at rated until cut-out (25 m/s), zero above cut-out. This is the textbook turbine curve and captures the non-linearity that simple linear models miss.
2. Scale by `capacityMW` and apply the scenario multiplier.
3. Confidence intervals are wider than solar at the same horizon — wind variability is structurally higher, and operators need to see that.

**Accuracy & feedback loop.** `lib/metrics.ts` computes MAPE, RMSE, and MBE on forecasts whose horizon has now passed (so we have actuals to compare against). `lib/alerts.ts` evaluates each new forecast against five operational patterns: ramp-up-steep / ramp-down-steep (>40% capacity change in 1 hour), curtailment-risk (forecast > capacity × 0.95), under-forecast (actual below lower bound for 3+ hours), over-forecast (actual above upper bound for 3+ hours), plant-offline (status flag). The mock retrain flow on `/models` bumps `ModelVersion`, slightly improves overall MAPE, and marks the new version active — letting operators see the lifecycle without us shipping a real ML training loop.

---

## 4. Tech Stack & AI Approach

| Layer | Technology | Why this choice |
|---|---|---|
| Framework | Next.js 15 App Router + TypeScript | Single-process deployment, no Python sidecar, runs on KREDL's existing infra |
| Persistence | Prisma + SQLite (prototype), PostgreSQL/Timescale-portable | One-line `DATABASE_URL` swap for production |
| Charts | Tremor (LineChart with confidence bands, AreaChart, BarChart) | Operator-grade time-series visuals out of the box |
| Maps | Leaflet + react-leaflet (OSM tiles) | No proprietary map keys, works fully offline |
| Forecast engine | Pure TypeScript (`lib/forecast.ts`), `simple-statistics` for utility math | Zero Python, deterministic, reproducible across operator laptops |
| Alerts | Pure TS evaluators in `lib/alerts.ts` | Five operational patterns, evidence JSON per alert |
| AI explanations | Optional `lib/ai.ts` (template-based, no LLM call) | Deterministic narrative for forecast variance, no API key needed |
| Brand palette | Orange/amber on dark | Solar/wind energy identity, high contrast for control-room screens |

The "AI approach" is deliberately interpretable. Production paths are explicit: the `forecast()` function signature is stable, so swapping the body for **Prophet**, **LSTM**, or a **Transformer-based forecaster** is a one-file change. The MVP picks the simpler model not because the team can't ship Prophet, but because operator trust requires a model whose every output is traceable to an input — and a black-box neural network handed to a grid operator on day one is the surest way to lose the trust we're trying to build.

---

## 5. Reproducibility & Demo Flow

### Setup

```bash
git clone https://github.com/sridhar7601/kredl-forecast.git
cd kredl-forecast
cp .env.example .env
npm install
npx prisma migrate deploy
npm run seed
npm run dev   # http://localhost:3000
```

- **Mock plants** — `scripts/generate-mock-plants.ts`: 6 solar plants (Pavagada, Koppal, Bidar, etc., 5–100 MW each) and 3 wind plants (Gadag, Chitradurga, 10–50 MW each).
- **Mock time-series** — `scripts/generate-mock-timeseries.ts`: 90 days of hourly Generation + WeatherReading per plant, with realistic diurnal solar curves, occasional cloud-affected days, wind plants showing calm periods and high-wind peaks, plus injected curtailment events.
- **Seeding** — `scripts/seed-demo.ts`: loads the data, generates forecasts for each plant across all 3 horizons × 3 scenarios, computes accuracy on the historical overlap, creates 4+ sample alerts (one ramp, one curtailment-risk, one under-forecast, one offline-maintenance), and inserts 2 model versions.

### Demo flow (2-minute hot path)

1. Dashboard loads with 9 plants, 245 MW total capacity, 118 MW current output, 198 MW tomorrow forecast, 4 alerts.
2. Click a 50 MW solar plant → Forecast tab opens.
3. Toggle horizon: day-ahead → week-ahead. The chart updates with visibly wider confidence bands on the longer horizon — uncertainty made operator-visible.
4. Toggle scenario group: BASE / OPTIMISTIC / PESSIMISTIC overlaid simultaneously, showing the realistic envelope rather than a single false-precision line.
5. Weather tab: cloud-cover spike on day 3 visibly correlates with the output dip on the History tab — a sanity check operators want before trusting the model.
6. Accuracy tab: current MAPE 8.4%, last-30-day MAPE 9.1%, MBE −2.3% (the model is mildly biased low). Daily MAPE bars show two outlier days with > 15% error.
7. Alerts tab: a `RAMP_DOWN_STEEP` alert at HIGH severity → click Acknowledge.
8. Navigate to `/models` → click "Retrain on latest data" → toast confirms `v0.3 active, MAPE improved to 7.8%`. Model version table appends the new row.

---

## 6. Security, Ethics & Privacy

- **Synthetic data only.** No real plant SCADA telemetry, no real weather feeds, no PPA-confidential generation data.
- **Audit trail by design.** Every forecast is persisted with its `modelVersion` tag and `meanConfidence`; every alert carries an `evidence` JSON blob; every accuracy computation is timestamped. The operator can reconstruct what the model said at any past moment.
- **No third-party data egress.** Default mode runs entirely on the operator's local Node process — no LLM calls, no cloud analytics, no proprietary forecasting API.
- **Authentication path.** Production deployment would put the operator console behind KREDL's existing SSO; the prototype skips auth to keep the demo path frictionless.

---

## 7. Known Limitations & Production Roadmap

### MVP scope explicitly excludes

- Real Prophet / neural forecasters — `lib/forecast.ts` has the integration seam; the body is what changes.
- Real weather API integration — `WeatherReading` is mocked; production wires IMD or commercial weather APIs.
- Real plant SCADA telemetry — production needs vendor-specific SCADA drivers per IPP.
- Curtailment dispatch commands to grid operators — currently informational, production would close the loop with KSLDC integration.
- Multi-plant ensemble forecasting — single-plant forecasts only in MVP; production would add cross-plant correlation modelling.

### Production hardening checklist

- Swap SQLite → PostgreSQL with Timescale for time-series partitioning by month per plant.
- Move forecast generation from on-demand `/api/forecasts/generate` to a scheduled job that runs every 15 minutes for intraday-6h horizons and once daily for day-ahead.
- Wire IMD weather forecast API + commercial backup (e.g. Meteomatics, Solcast) with automatic fallback if the primary feed fails.
- Calibrate the diurnal profile per plant using the previous full year, including seasonality (monsoon vs summer cloud patterns differ materially in Karnataka).
- Add operator roles (read-only viewers, schedulers with ack permission, admins with retrain permission).
- Plug the forecast engine into KREDL's REMC-mandated forecast submission API, so submissions to KSLDC become a one-click publish from the operator console.

---

## 8. Conclusion

SuryaVayu AI demonstrates a credible day-ahead and intraday renewable-forecasting workflow built for the realities of Karnataka's grid: pure-JavaScript forecast engine that runs on any operator laptop, scenario-based forecasts that match how operators actually reason, horizon-aware confidence bands that surface uncertainty rather than hiding it, self-reported accuracy metrics that build trust over time, and an alerts engine that turns forecast outputs into operational actions. The architecture is deliberately deployment-friendly — single Node process, PostgreSQL-portable Prisma schema, no Python sidecar, no proprietary map keys, no mandatory LLM dependency — so the path from this prototype to a KREDL-internal pilot is environment configuration and weather-API wiring, not re-architecture.

The differentiator versus generic forecasting tooling: every forecast carries **explicit uncertainty** (confidence bands), **scenario context** (base/optimistic/pessimistic), and **accuracy self-reporting** (MAPE/RMSE/MBE trended over time). Combined with the alerts engine and model-versioning loop, that turns a forecast from a single number into an *operator workflow* — which is what's needed to actually move Karnataka's renewable forecast accuracy from where it is today toward global benchmarks.
