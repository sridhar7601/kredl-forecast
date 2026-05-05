import { faker } from "@faker-js/faker";
import { db } from "../lib/db";
import { generateForecast } from "../lib/forecast";
import { detectAccuracyAlerts, detectForecastAlerts, detectModelDrift } from "../lib/alerts";
import { computeAccuracyMetrics } from "../lib/metrics";
import { compareToBaselines } from "../lib/baselines";
import { buildPlantRows } from "./generate-mock-plants";
import { generateRealDrivenTimeseries } from "./generate-timeseries";
import type { ForecastHorizon, PlantStatus, PlantType } from "../lib/types";

faker.seed(42);

async function resetData() {
  await db.alert.deleteMany();
  await db.forecastAccuracy.deleteMany();
  await db.forecast.deleteMany();
  await db.generation.deleteMany();
  await db.weatherReading.deleteMany();
  await db.modelVersion.deleteMany();
  await db.plant.deleteMany();
}

async function seedPlants() {
  const plants = buildPlantRows();
  const byCode = new Map<string, string>();
  for (const p of plants) {
    const row = await db.plant.create({
      data: {
        code: p.code,
        name: p.name,
        type: p.type,
        capacityMW: p.capacityMW,
        lat: p.lat,
        lng: p.lng,
        district: p.district,
        status: p.status,
        commissionedAt: p.commissionedAt,
      },
    });
    byCode.set(p.code, row.id);
  }
  return byCode;
}

async function seedTimeseries(plantCodeToId: Map<string, string>) {
  const { generation, weather, realPlants, fallbackPlants } = generateRealDrivenTimeseries();
  // eslint-disable-next-line no-console
  console.log(
    `Seeding timeseries: ${realPlants} plants from Open-Meteo, ${fallbackPlants} from mock fallback.`,
  );

  await db.generation.createMany({
    data: generation
      .filter((row) => plantCodeToId.has(row.plantCode))
      .map((row) => ({
        plantId: plantCodeToId.get(row.plantCode)!,
        timestamp: new Date(row.timestamp),
        actualMW: row.actualMW,
        availableMW: row.availableMW,
        curtailedMW: row.curtailedMW,
      })),
  });
  await db.weatherReading.createMany({
    data: weather
      .filter((row) => plantCodeToId.has(row.plantCode))
      .map((row) => ({
        plantId: plantCodeToId.get(row.plantCode)!,
        timestamp: new Date(row.timestamp),
        ghi: row.ghi,
        cloudCover: row.cloudCover,
        temperature: row.temperature,
        windSpeed: row.windSpeed,
        windDirection: row.windDirection,
        humidity: row.humidity,
      })),
  });
}

async function generateForecastsAndAccuracy() {
  const plants = await db.plant.findMany();
  const horizons: ForecastHorizon[] = ["DAY_AHEAD", "INTRADAY_6H", "WEEK"];
  const baselineSummaries: Array<{
    plantId: string;
    plantName: string;
    ourMape: number;
    persistenceMape: number;
    seasonalNaiveMape: number;
  }> = [];

  for (const plant of plants) {
    const history = await db.generation.findMany({
      where: { plantId: plant.id },
      orderBy: { timestamp: "asc" },
    });
    const weather = await db.weatherReading.findMany({
      where: { plantId: plant.id },
      orderBy: { timestamp: "asc" },
    });

    for (const horizon of horizons) {
      const horizonHours = horizon === "INTRADAY_6H" ? 6 : horizon === "DAY_AHEAD" ? 24 : 24 * 7;
      const weatherFuture = weather.slice(-horizonHours);
      for (const scenario of ["BASE", "OPTIMISTIC", "PESSIMISTIC"] as const) {
        const result = generateForecast({
          plantId: plant.id,
          plantType: plant.type as PlantType,
          capacityMW: plant.capacityMW,
          history: history.slice(-24 * 30),
          weatherHistory: weather.slice(-24 * 30),
          weatherForecast: weatherFuture,
          horizon,
          scenario,
        });
        const forecast = await db.forecast.create({
          data: {
            plantId: plant.id,
            forHorizon: horizon,
            scenario,
            points: JSON.stringify(result.points),
            modelVersion: result.modelVersion,
            meanConfidence: result.meanConfidence,
          },
        });

        if (scenario === "BASE") {
          // Use the trailing window of history (already has actuals) as the back-test target
          // and align our predicted MW to those same indices.
          const actualWindow = history.slice(-result.points.length);
          const actual = actualWindow.map((x) => x.actualMW);
          const predicted = result.points.slice(0, actual.length).map((x) => x.forecastMW);
          const metrics = computeAccuracyMetrics(actual, predicted);
          await db.forecastAccuracy.create({
            data: {
              forecastId: forecast.id,
              plantId: plant.id,
              mape: metrics.mape,
              rmse: metrics.rmse,
              mbe: metrics.mbe,
              sampleSize: metrics.sampleSize,
            },
          });

          if (horizon === "DAY_AHEAD" && actualWindow.length >= 6) {
            const cmp = compareToBaselines({
              history,
              actual: actualWindow.map((x) => ({
                timestamp: new Date(x.timestamp),
                actualMW: x.actualMW,
                availableMW: x.availableMW,
                curtailedMW: x.curtailedMW,
              })),
              ourPredicted: predicted,
            });
            baselineSummaries.push({
              plantId: plant.id,
              plantName: plant.name,
              ourMape: cmp.ourMape,
              persistenceMape: cmp.persistenceMape,
              seasonalNaiveMape: cmp.seasonalNaiveMape,
            });
          }
        }
      }
    }
  }

  if (baselineSummaries.length > 0) {
    const meanOurs = baselineSummaries.reduce((s, x) => s + x.ourMape, 0) / baselineSummaries.length;
    const meanPersistence = baselineSummaries.reduce((s, x) => s + x.persistenceMape, 0) / baselineSummaries.length;
    const meanSeasonal = baselineSummaries.reduce((s, x) => s + x.seasonalNaiveMape, 0) / baselineSummaries.length;
    // eslint-disable-next-line no-console
    console.log(
      `Baselines (DAY_AHEAD, mean across plants): SuryaVayu ${meanOurs.toFixed(2)}% MAPE vs Persistence ${meanPersistence.toFixed(2)}% vs Seasonal-Naive ${meanSeasonal.toFixed(2)}%.`,
    );
  }

  return baselineSummaries;
}

async function generateAlerts() {
  const plants = await db.plant.findMany();
  for (const plant of plants) {
    const base = await db.forecast.findFirst({
      where: { plantId: plant.id, scenario: "BASE", forHorizon: "DAY_AHEAD" },
      orderBy: { issuedAt: "desc" },
    });
    if (!base) continue;
    const points = JSON.parse(base.points) as Array<{
      timestamp: string;
      forecastMW: number;
      lowerBoundMW: number;
      upperBoundMW: number;
    }>;

    const generation = await db.generation.findMany({
      where: { plantId: plant.id },
      orderBy: { timestamp: "desc" },
      take: points.length,
    });
    const forecastAlerts = detectForecastAlerts({
      plantId: plant.id,
      plantName: plant.name,
      capacityMW: plant.capacityMW,
      status: plant.status as PlantStatus,
      forecast: points.map((p) => ({ ...p, timestamp: new Date(p.timestamp) })),
    });
    const accuracyAlerts = detectAccuracyAlerts({
      plantId: plant.id,
      plantName: plant.name,
      actual: generation.reverse().map((g) => ({ ...g, timestamp: new Date(g.timestamp) })),
      baselineForecast: points.map((p) => ({ ...p, timestamp: new Date(p.timestamp) })),
    });

    for (const alert of [...forecastAlerts, ...accuracyAlerts].slice(0, 3)) {
      await db.alert.create({
        data: {
          plantId: alert.plantId ?? null,
          type: alert.type,
          severity: alert.severity,
          title: alert.title,
          description: alert.description,
          evidence: JSON.stringify(alert.evidence),
        },
      });
    }
  }
}

async function seedDriftAlert() {
  // Pick the plant with the worst latest accuracy and synthesize a drift situation
  // by raising its 7-day MAPE relative to its 30-day average.
  const plant = await db.plant.findFirst({
    where: { status: "ACTIVE" },
    orderBy: { capacityMW: "desc" },
  });
  if (!plant) return;
  const accuracy = await db.forecastAccuracy.findMany({
    where: { plantId: plant.id },
    orderBy: { computedAt: "desc" },
  });
  const mape30d = accuracy.length > 0
    ? accuracy.reduce((s, a) => s + a.mape, 0) / accuracy.length
    : 8.4;
  const mape7d = mape30d * 1.85;
  const candidate = detectModelDrift({
    plantId: plant.id,
    plantName: plant.name,
    mape7d,
    mape30d,
  });
  if (!candidate) return;
  await db.alert.create({
    data: {
      plantId: candidate.plantId ?? null,
      type: candidate.type,
      severity: candidate.severity,
      title: candidate.title,
      description: candidate.description,
      evidence: JSON.stringify(candidate.evidence),
    },
  });
  // eslint-disable-next-line no-console
  console.log(`Seeded MODEL_DRIFT alert for ${plant.name} (mape7d=${mape7d.toFixed(2)}%, mape30d=${mape30d.toFixed(2)}%).`);
}

async function seedModels() {
  await db.modelVersion.createMany({
    data: [
      {
        versionTag: "sv-0.1",
        description: "Initial seasonal naive + weather adjustment baseline.",
        overallMape: 9.2,
        active: false,
      },
      {
        versionTag: "sv-0.2",
        description: "Improved weather weighting and scenario calibration.",
        overallMape: 8.4,
        active: false,
      },
      {
        versionTag: "sv-0.3",
        description: "Single feature-conditioned model with attribution intermediates and drift detection.",
        overallMape: 7.6,
        active: true,
      },
    ],
  });
}

async function main() {
  await resetData();
  const mapping = await seedPlants();
  await seedTimeseries(mapping);
  await generateForecastsAndAccuracy();
  await generateAlerts();
  await seedDriftAlert();
  await seedModels();
  // eslint-disable-next-line no-console
  console.log("Seed complete: plants, hourly weather+generation (real-driven where available), forecasts, accuracy, baselines, alerts, model versions.");
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
