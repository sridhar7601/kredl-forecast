import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generateForecast } from "@/lib/forecast";
import { narrateForecast } from "@/lib/llm-narration";
import type { ForecastHorizon, PlantType, ScenarioType } from "@/lib/types";

const HORIZONS: ForecastHorizon[] = ["DAY_AHEAD", "INTRADAY_6H", "WEEK"];
const SCENARIOS: ScenarioType[] = ["BASE", "OPTIMISTIC", "PESSIMISTIC"];

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const horizonParam = (searchParams.get("horizon") ?? "DAY_AHEAD").toUpperCase() as ForecastHorizon;
  const scenarioParam = (searchParams.get("scenario") ?? "BASE").toUpperCase() as ScenarioType;
  const horizon = HORIZONS.includes(horizonParam) ? horizonParam : "DAY_AHEAD";
  const scenario = SCENARIOS.includes(scenarioParam) ? scenarioParam : "BASE";

  const plant = await db.plant.findUnique({ where: { id } });
  if (!plant) return NextResponse.json({ error: "Plant not found" }, { status: 404 });

  const history = await db.generation.findMany({
    where: { plantId: id },
    orderBy: { timestamp: "asc" },
    take: 24 * 30,
  });
  const weather = await db.weatherReading.findMany({
    where: { plantId: id },
    orderBy: { timestamp: "asc" },
  });
  const horizonHours = horizon === "INTRADAY_6H" ? 6 : horizon === "DAY_AHEAD" ? 24 : 24 * 7;
  const result = generateForecast({
    plantId: id,
    plantType: plant.type as PlantType,
    capacityMW: plant.capacityMW,
    history,
    weatherHistory: weather.slice(-24 * 30),
    weatherForecast: weather.slice(-horizonHours),
    horizon,
    scenario,
  });

  const narration = await narrateForecast({
    plantId: id,
    plantName: plant.name,
    plantType: plant.type,
    capacityMW: plant.capacityMW,
    scenario,
    points: result.points,
    attribution: result.attribution,
    weather: weather
      .slice(-horizonHours)
      .map((w) => ({ ...w, timestamp: new Date(w.timestamp) })),
  });

  return NextResponse.json({
    plantId: id,
    horizon,
    scenario,
    narration: narration.text,
    source: narration.source,
    cached: narration.cached,
  });
}
