import { db } from "@/lib/db";
import type { ForecastHorizon, ForecastPoint, PlantType, WeatherPoint } from "@/lib/types";
import { generateForecast } from "@/lib/forecast";

export function parseForecastPoints(points: string): ForecastPoint[] {
  const parsed = JSON.parse(points) as Array<{
    timestamp: string;
    forecastMW: number;
    lowerBoundMW: number;
    upperBoundMW: number;
  }>;
  return parsed.map((p) => ({
    timestamp: new Date(p.timestamp),
    forecastMW: p.forecastMW,
    lowerBoundMW: p.lowerBoundMW,
    upperBoundMW: p.upperBoundMW,
  }));
}

export async function ensureForecastsForPlant(plantId: string, horizon: ForecastHorizon): Promise<void> {
  const scenarios = ["BASE", "OPTIMISTIC", "PESSIMISTIC"] as const;
  const existing = await db.forecast.count({ where: { plantId, forHorizon: horizon } });
  if (existing > 0) return;

  const plant = await db.plant.findUnique({ where: { id: plantId } });
  if (!plant) return;

  const now = new Date();
  const from = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  const history = await db.generation.findMany({
    where: { plantId, timestamp: { gte: from, lte: now } },
    orderBy: { timestamp: "asc" },
  });
  const weatherForecast = await db.weatherReading.findMany({
    where: { plantId, timestamp: { gte: now } },
    orderBy: { timestamp: "asc" },
    take: horizon === "INTRADAY_6H" ? 6 : horizon === "DAY_AHEAD" ? 24 : 24 * 7,
  });

  for (const scenario of scenarios) {
    const result = generateForecast({
      plantId,
      plantType: plant.type as PlantType,
      capacityMW: plant.capacityMW,
      history,
      weatherHistory: [],
      weatherForecast,
      horizon,
      scenario,
    });
    await db.forecast.create({
      data: {
        plantId,
        forHorizon: horizon,
        scenario,
        points: JSON.stringify(result.points),
        modelVersion: result.modelVersion,
        meanConfidence: result.meanConfidence,
      },
    });
  }
}

export async function latestWeather(plantId: string, hours: number): Promise<WeatherPoint[]> {
  const now = new Date();
  const from = new Date(now.getTime() - hours * 3600 * 1000);
  return db.weatherReading.findMany({
    where: { plantId, timestamp: { gte: from, lte: now } },
    orderBy: { timestamp: "asc" },
  });
}
