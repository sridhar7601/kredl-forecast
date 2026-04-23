# SuryaVayu AI - Theme 10 Solution Document

## Problem

KREDL/KSPDCL operators need day-ahead and intraday visibility of renewable output across distributed solar and wind plants, with explicit uncertainty and actionable alerts for ramp or curtailment risk.

## Approach

SuryaVayu AI is a Next.js + Prisma control-room application that combines:

1. 90-day hourly synthetic plant generation and weather data.
2. Pure JavaScript forecasting (no Python runtime dependency) with:
   - solar diurnal baseline from past 30 days,
   - weather adjustments (cloud and temperature derating),
   - wind power curve behavior,
   - scenario multipliers (BASE/OPTIMISTIC/PESSIMISTIC),
   - horizon-aware confidence intervals.
3. Forecast quality analytics with MAPE/RMSE/MBE.
4. Alerting for ramp events, curtailment risk, persistent under/over forecast, and offline plants.
5. Model version history with mock retrain flow.

## Data Model

Prisma models:

- `Plant` with enums `PlantType` and `PlantStatus`.
- `WeatherReading` and `Generation` for time series.
- `Forecast` with `ScenarioType`.
- `ForecastAccuracy` for MAPE/RMSE/MBE.
- `Alert` with `AlertType` and `AlertSeverity`.
- `ModelVersion` for versioned forecast strategies.

## APIs

- `GET /api/plants`
- `GET /api/plants/[id]`
- `GET /api/plants/[id]/history`
- `GET /api/plants/[id]/forecast`
- `GET|POST /api/forecasts/generate`
- `GET|POST /api/forecasts/accuracy`
- `GET /api/alerts`
- `PUT|POST /api/alerts/[id]/ack`
- `GET /api/dashboard/overview`
- `GET /api/models/versions`
- `POST /api/models/retrain`

## UI Pages

- `/` Grid control room dashboard with Tremor cards, area chart, map, and alert feed.
- `/plants` Plant table with type/status controls.
- `/plants/[id]` Money-shot detail page with tabs: Forecast, History, Weather, Accuracy, Alerts.
- `/alerts` Grid-wide alert operations page.
- `/models` Model lifecycle and retrain page.

## Seed Design

- `scripts/generate-mock-plants.ts`: 6 solar + 3 wind plants across Karnataka.
- `scripts/generate-mock-timeseries.ts`: 90-day hourly generation and weather with diurnal behavior and injected curtailment.
- `scripts/seed-demo.ts`: loads DB, generates forecasts, computes accuracy, creates alerts, and inserts two model versions.

## Mock AI

`USE_MOCK_AI=true` enables deterministic natural-language forecast variance explanation in `lib/ai.ts`.

## Architecture Diagram

- Source: `docs/diagrams/architecture.mmd`
- Rendered artifact: `docs/diagrams/architecture.svg`

## Known Limitations

- PNG diagram and PDF rendering require local CLI execution (`npx @mermaid-js/mermaid-cli`, `pandoc`, headless Chrome).
- Verification gates and git push/repo creation require shell access.

## Regenerating the PDF

```bash
pandoc docs/solution-document.md -o /tmp/suryavayu-solution.html --standalone --metadata title="SuryaVayu AI Theme 10"
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu --no-pdf-header-footer \
  --print-to-pdf="$(pwd)/docs/solution-document.pdf" "file:///tmp/suryavayu-solution.html"
```
