import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { compareToBaselines } from "@/lib/baselines";
import { parseForecastPoints } from "@/lib/data";
import type { ForecastHorizon } from "@/lib/types";

const HORIZONS: ForecastHorizon[] = ["DAY_AHEAD", "INTRADAY_6H", "WEEK"];

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const horizonParam = (searchParams.get("horizon") ?? "DAY_AHEAD").toUpperCase() as ForecastHorizon;
  const horizon = HORIZONS.includes(horizonParam) ? horizonParam : "DAY_AHEAD";

  const plant = await db.plant.findUnique({ where: { id } });
  if (!plant) return NextResponse.json({ error: "Plant not found" }, { status: 404 });

  const forecast = await db.forecast.findFirst({
    where: { plantId: id, scenario: "BASE", forHorizon: horizon },
    orderBy: { issuedAt: "desc" },
  });
  if (!forecast) return NextResponse.json({ error: "No BASE forecast for horizon" }, { status: 404 });

  const points = parseForecastPoints(forecast.points);
  if (points.length === 0) {
    return NextResponse.json({ error: "Empty forecast" }, { status: 422 });
  }

  // Use the trailing window of generation history that overlaps the forecast points
  // for back-test alignment (same window the seed uses).
  const history = await db.generation.findMany({
    where: { plantId: id },
    orderBy: { timestamp: "asc" },
  });
  const actualWindow = history.slice(-points.length);
  const ourPredicted = points.slice(0, actualWindow.length).map((p) => p.forecastMW);

  const result = compareToBaselines({
    history,
    actual: actualWindow.map((row) => ({
      timestamp: new Date(row.timestamp),
      actualMW: row.actualMW,
      availableMW: row.availableMW,
      curtailedMW: row.curtailedMW,
    })),
    ourPredicted,
  });

  return NextResponse.json({
    plantId: id,
    horizon,
    forecastModelVersion: forecast.modelVersion,
    ...result,
  });
}
