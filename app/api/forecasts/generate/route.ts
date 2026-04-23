import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generateForecast } from "@/lib/forecast";
import type { ForecastHorizon, PlantType } from "@/lib/types";

async function generateForPlant(plantId: string, horizons: ForecastHorizon[]) {
  const plant = await db.plant.findUnique({ where: { id: plantId } });
  if (!plant) return [];

  const now = new Date();
  const historyFrom = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  const history = await db.generation.findMany({
    where: { plantId, timestamp: { gte: historyFrom, lte: now } },
    orderBy: { timestamp: "asc" },
  });

  const created = [];
  for (const horizon of horizons) {
    const required = horizon === "INTRADAY_6H" ? 6 : horizon === "DAY_AHEAD" ? 24 : 24 * 7;
    const weatherForecast = await db.weatherReading.findMany({
      where: { plantId, timestamp: { gte: now } },
      orderBy: { timestamp: "asc" },
      take: required,
    });

    for (const scenario of ["BASE", "OPTIMISTIC", "PESSIMISTIC"] as const) {
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

      const row = await db.forecast.create({
        data: {
          plantId,
          forHorizon: horizon,
          scenario,
          points: JSON.stringify(result.points),
          modelVersion: result.modelVersion,
          meanConfidence: result.meanConfidence,
        },
      });
      created.push(row);
    }
  }

  return created;
}

export async function GET() {
  const plants = await db.plant.findMany();
  const all = await Promise.all(plants.map((p) => generateForPlant(p.id, ["DAY_AHEAD", "INTRADAY_6H", "WEEK"])));
  return NextResponse.json({ total: all.flat().length, items: all.flat() });
}

export async function POST(request: Request) {
  const body = await request.json();
  const plantId = body.plantId as string | undefined;
  const horizons = (body.horizons as ForecastHorizon[] | undefined) ?? ["DAY_AHEAD"];

  if (!plantId) {
    return NextResponse.json({ error: "plantId is required" }, { status: 400 });
  }

  const items = await generateForPlant(plantId, horizons);
  return NextResponse.json({ total: items.length, items });
}
