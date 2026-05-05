import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generateForecast } from "@/lib/forecast";
import { parseForecastPoints } from "@/lib/data";
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

  const forecast = await db.forecast.findFirst({
    where: { plantId: id, forHorizon: horizon, scenario },
    orderBy: { issuedAt: "desc" },
  });

  if (!forecast) {
    return NextResponse.json({ error: "Forecast not found" }, { status: 404 });
  }

  // Recompute attribution on the fly (it isn't persisted, but it's deterministic given
  // the same history+weather+plant+scenario, so the numbers line up with the stored points).
  const plant = await db.plant.findUnique({ where: { id } });
  let attribution: ReturnType<typeof generateForecast>["attribution"] = [];
  if (plant) {
    const history = await db.generation.findMany({
      where: { plantId: id },
      orderBy: { timestamp: "asc" },
      take: 24 * 30,
    });
    const horizonHours = horizon === "INTRADAY_6H" ? 6 : horizon === "DAY_AHEAD" ? 24 : 24 * 7;
    const weather = await db.weatherReading.findMany({
      where: { plantId: id },
      orderBy: { timestamp: "asc" },
    });
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
    attribution = result.attribution;
  }

  return NextResponse.json({
    ...forecast,
    points: parseForecastPoints(forecast.points),
    attribution,
  });
}
