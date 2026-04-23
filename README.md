# SuryaVayu AI - Renewable Forecasting for KREDL/KSPDCL

Day-ahead and intraday renewable generation forecasting for Karnataka's solar and wind fleet, with scenario toggles, confidence bands, and ramp-event alerts.

> **PanIIT AI for Bharat Hackathon** - Theme 10: AI for Renewable Generation Forecasting

## Quick Start

```bash
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run seed
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Demo Data

`npm run seed` creates:

- 9 plants (6 solar, 3 wind) across Karnataka
- 90 days of hourly generation and weather per plant
- Forecast rows for 3 horizons x 3 scenarios
- Accuracy records (MAPE/RMSE/MBE)
- Alert feed with ramp, curtailment, deviation, and offline signals
- 2 model versions (`sv-0.1`, `sv-0.2`)

## Architecture

See `docs/diagrams/architecture.mmd` and `docs/diagrams/architecture.svg`.

## Tech Stack

- Next.js 15/16 App Router + TypeScript
- Prisma + SQLite
- Tailwind CSS v3
- Tremor charts
- Leaflet + react-leaflet
- simple-statistics
- Mock AI template reasoning (`USE_MOCK_AI=true`)

## Documentation

See `docs/solution-document.md`.
This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
