import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { computeAccuracyMetrics } from "@/lib/metrics";

export async function GET() {
  const items = await db.forecastAccuracy.findMany({ orderBy: { computedAt: "desc" }, take: 200 });
  return NextResponse.json({ total: items.length, items });
}

export async function POST() {
  const forecasts = await db.forecast.findMany({
    where: { scenario: "BASE" },
    orderBy: { issuedAt: "desc" },
    take: 120,
  });

  const created = [];
  for (const forecast of forecasts) {
    const points = JSON.parse(forecast.points) as Array<{ timestamp: string; forecastMW: number }>;
    if (points.length === 0) continue;
    const actualRows = await db.generation.findMany({
      where: {
        plantId: forecast.plantId,
        timestamp: {
          gte: new Date(points[0].timestamp),
          lte: new Date(points[points.length - 1].timestamp),
        },
      },
      orderBy: { timestamp: "asc" },
      take: points.length,
    });
    if (actualRows.length < 3) continue;
    const actual = actualRows.map((row) => row.actualMW);
    const predicted = points.slice(0, actualRows.length).map((row) => row.forecastMW);
    const m = computeAccuracyMetrics(actual, predicted);
    const row = await db.forecastAccuracy.create({
      data: {
        forecastId: forecast.id,
        plantId: forecast.plantId,
        mape: m.mape,
        rmse: m.rmse,
        mbe: m.mbe,
        sampleSize: m.sampleSize,
        notes: "Computed via /api/forecasts/accuracy",
      },
    });
    created.push(row);
  }

  return NextResponse.json({ total: created.length, items: created });
}
