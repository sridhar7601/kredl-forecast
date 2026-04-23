import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { computeAccuracyMetrics } from "@/lib/metrics";

export async function POST() {
  const forecasts = await db.forecast.findMany({
    where: { scenario: "BASE" },
    orderBy: { issuedAt: "desc" },
    take: 200,
  });

  const created = [];
  for (const forecast of forecasts) {
    const points = JSON.parse(forecast.points) as Array<{ timestamp: string; forecastMW: number }>;
    const timestamps = points.map((p) => new Date(p.timestamp));
    if (timestamps.length === 0) continue;

    const actualRows = await db.generation.findMany({
      where: {
        plantId: forecast.plantId,
        timestamp: {
          gte: timestamps[0],
          lte: timestamps[timestamps.length - 1],
        },
      },
      orderBy: { timestamp: "asc" },
      take: points.length,
    });

    if (actualRows.length < 3) continue;

    const actual = actualRows.map((row) => row.actualMW);
    const predicted = points.slice(0, actualRows.length).map((p) => p.forecastMW);
    const metrics = computeAccuracyMetrics(actual, predicted);

    const row = await db.forecastAccuracy.create({
      data: {
        forecastId: forecast.id,
        plantId: forecast.plantId,
        mape: metrics.mape,
        rmse: metrics.rmse,
        mbe: metrics.mbe,
        sampleSize: metrics.sampleSize,
        notes: "Auto-computed by /api/forecasts/accuracy/compute",
      },
    });
    created.push(row);
  }

  return NextResponse.json({ total: created.length, items: created });
}
