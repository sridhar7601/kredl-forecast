import { faker } from "@faker-js/faker";
import { db } from "../lib/db";
import { generateForecast } from "../lib/forecast";
import { detectAccuracyAlerts, detectForecastAlerts } from "../lib/alerts";
import { computeAccuracyMetrics } from "../lib/metrics";
import { buildPlantRows } from "./generate-mock-plants";
import { generateTimeseries } from "./generate-mock-timeseries";
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
  const { generation, weather } = generateTimeseries(90);
  for (const row of generation) {
    const plantId = plantCodeToId.get(row.plantCode);
    if (!plantId) continue;
    await db.generation.create({
      data: {
        plantId,
        timestamp: new Date(row.timestamp),
        actualMW: row.actualMW,
        availableMW: row.availableMW,
        curtailedMW: row.curtailedMW,
      },
    });
  }
  for (const row of weather) {
    const plantId = plantCodeToId.get(row.plantCode);
    if (!plantId) continue;
    await db.weatherReading.create({
      data: {
        plantId,
        timestamp: new Date(row.timestamp),
        ghi: row.ghi,
        cloudCover: row.cloudCover,
        temperature: row.temperature,
        windSpeed: row.windSpeed,
        windDirection: row.windDirection,
        humidity: row.humidity,
      },
    });
  }
}

async function generateForecastsAndAccuracy() {
  const plants = await db.plant.findMany();
  const horizons: ForecastHorizon[] = ["DAY_AHEAD", "INTRADAY_6H", "WEEK"];

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
      const weatherFuture = weather.slice(-((horizon === "INTRADAY_6H" ? 6 : horizon === "DAY_AHEAD" ? 24 : 24 * 7)));
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
          const actual = history.slice(-result.points.length).map((x) => x.actualMW);
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
        }
      }
    }
  }
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
  await seedModels();
  // eslint-disable-next-line no-console
  console.log("Seed complete: 9 plants, 90-day hourly weather+generation, forecasts, accuracy, alerts, model versions.");
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
