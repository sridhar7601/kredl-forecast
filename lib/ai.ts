import type { ForecastPoint, ScenarioType, WeatherPoint } from "@/lib/types";

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function mockExplainForecast(points: ForecastPoint[], weather: WeatherPoint[], scenario: ScenarioType): string {
  const avgMw = avg(points.map((p) => p.forecastMW));
  const avgCloud = avg(weather.map((w) => w.cloudCover ?? 0.2));
  const avgWind = avg(weather.map((w) => w.windSpeed ?? 6.5));
  const scenarioText =
    scenario === "OPTIMISTIC"
      ? "optimistic uplift assumptions"
      : scenario === "PESSIMISTIC"
        ? "conservative stress assumptions"
        : "baseline weather assumptions";

  return `This forecast uses ${scenarioText}. Mean projected output is ${avgMw.toFixed(
    1,
  )} MW. Cloud cover averages ${(avgCloud * 100).toFixed(0)}% and wind speed averages ${avgWind.toFixed(
    1,
  )} m/s, which drives interval width and confidence across the horizon.`;
}

export async function explainForecastVariance(
  points: ForecastPoint[],
  weather: WeatherPoint[],
  scenario: ScenarioType,
): Promise<string> {
  if (process.env.USE_MOCK_AI !== "false") {
    return mockExplainForecast(points, weather, scenario);
  }
  throw new Error("Real AI not implemented yet — set USE_MOCK_AI=true");
}
