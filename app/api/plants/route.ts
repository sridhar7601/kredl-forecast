import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  const plants = await db.plant.findMany({ orderBy: { name: "asc" } });
  const items = await Promise.all(
    plants.map(async (plant) => {
      const latestGeneration = await db.generation.findFirst({
        where: { plantId: plant.id },
        orderBy: { timestamp: "desc" },
      });
      const latestForecast = await db.forecast.findFirst({
        where: { plantId: plant.id, scenario: "BASE", forHorizon: "DAY_AHEAD" },
        orderBy: { issuedAt: "desc" },
      });
      const latestAccuracy = await db.forecastAccuracy.findFirst({
        where: { plantId: plant.id },
        orderBy: { computedAt: "desc" },
      });
      return {
        ...plant,
        latestGenerationMW: latestGeneration?.actualMW ?? 0,
        latestForecastMW: latestForecast ? Number((JSON.parse(latestForecast.points) as Array<{ forecastMW: number }>)[0]?.forecastMW ?? 0) : 0,
        latestMape: latestAccuracy?.mape ?? null,
      };
    }),
  );

  return NextResponse.json({ total: items.length, plants: items });
}
