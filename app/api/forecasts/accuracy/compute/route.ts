import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { computeAccuracyMetrics } from "@/lib/metrics";
import { detectModelDrift } from "@/lib/alerts";

export async function POST() {
  const forecasts = await db.forecast.findMany({
    where: { scenario: "BASE" },
    orderBy: { issuedAt: "desc" },
    take: 200,
  });

  const created = [];
  const touchedPlants = new Set<string>();
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
    touchedPlants.add(forecast.plantId);
  }

  // After accuracy is recomputed, evaluate drift per plant: 7d rolling MAPE vs 30d.
  const driftAlerts: string[] = [];
  for (const plantId of touchedPlants) {
    const plant = await db.plant.findUnique({ where: { id: plantId } });
    if (!plant) continue;
    const recent = await db.forecastAccuracy.findMany({
      where: { plantId },
      orderBy: { computedAt: "desc" },
      take: 30,
    });
    if (recent.length < 4) continue;
    const last7 = recent.slice(0, 7);
    const mape7d = last7.reduce((s, r) => s + r.mape, 0) / last7.length;
    const mape30d = recent.reduce((s, r) => s + r.mape, 0) / recent.length;
    const candidate = detectModelDrift({
      plantId,
      plantName: plant.name,
      mape7d,
      mape30d,
    });
    if (!candidate) continue;

    // dedupe: skip if there's already an open MODEL_DRIFT alert for this plant
    const existing = await db.alert.findFirst({
      where: { plantId, type: "MODEL_DRIFT", acknowledged: false },
    });
    if (existing) continue;

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
    driftAlerts.push(plantId);
  }

  return NextResponse.json({
    total: created.length,
    items: created,
    driftAlertsCreated: driftAlerts.length,
  });
}
