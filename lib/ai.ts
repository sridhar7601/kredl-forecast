import type { AttributionPoint, ForecastPoint, ScenarioType, WeatherPoint } from "@/lib/types";

// Deterministic, attribution-based explanation. No hosted LLM is used (the KREDL brief
// explicitly forbids hosted LLMs on sensitive data). The narrative is derived from the
// same intermediate terms the forecast engine returns.

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function scenarioLabel(scenario: ScenarioType): string {
  if (scenario === "OPTIMISTIC") return "optimistic uplift";
  if (scenario === "PESSIMISTIC") return "conservative stress";
  return "baseline";
}

function pickPeak(points: ForecastPoint[]): ForecastPoint | null {
  if (points.length === 0) return null;
  return points.reduce((max, p) => (p.forecastMW > max.forecastMW ? p : max), points[0]);
}

export interface ExplainInput {
  points: ForecastPoint[];
  attribution?: AttributionPoint[];
  weather: WeatherPoint[];
  scenario: ScenarioType;
}

export function explainForecast(input: ExplainInput): string {
  const { points, attribution, weather, scenario } = input;
  const meanMW = avg(points.map((p) => p.forecastMW));
  const peak = pickPeak(points);
  const cloud = avg(weather.map((w) => w.cloudCover ?? 0.2));
  const wind = avg(weather.map((w) => w.windSpeed ?? 6.5));

  const peakAttribution = peak && attribution
    ? attribution.find((a) => new Date(a.timestamp).getTime() === new Date(peak.timestamp).getTime())
    : undefined;

  const breakdown = peakAttribution
    ? ` Peak hour ${new Date(peak!.timestamp).toISOString().slice(11, 16)}: ` +
      `${peakAttribution.baselineMW.toFixed(1)} MW diurnal baseline` +
      (peakAttribution.cloudPenaltyMW > 0 ? ` − ${peakAttribution.cloudPenaltyMW.toFixed(1)} MW cloud penalty` : "") +
      (peakAttribution.tempDeratingMW > 0 ? ` − ${peakAttribution.tempDeratingMW.toFixed(1)} MW temperature derate` : "") +
      (peakAttribution.windFactorMW < 0 ? ` − ${(-peakAttribution.windFactorMW).toFixed(1)} MW wind shortfall` : "") +
      (Math.abs(peakAttribution.scenarioAdjustmentMW) > 0.05
        ? ` ${peakAttribution.scenarioAdjustmentMW > 0 ? "+" : "−"} ${Math.abs(peakAttribution.scenarioAdjustmentMW).toFixed(1)} MW scenario adjustment`
        : "") +
      ` = ${peakAttribution.finalMW.toFixed(1)} MW.`
    : "";

  return (
    `${scenarioLabel(scenario).charAt(0).toUpperCase()}${scenarioLabel(scenario).slice(1)} run. ` +
    `Mean projected output ${meanMW.toFixed(1)} MW across the horizon. ` +
    `Cloud cover averages ${(cloud * 100).toFixed(0)}%, wind ${wind.toFixed(1)} m/s.` +
    breakdown
  );
}

// Backwards-compatible thin wrapper for callers that still expect a Promise-returning
// "explainForecastVariance" interface (previous API contract).
export async function explainForecastVariance(
  points: ForecastPoint[],
  weather: WeatherPoint[],
  scenario: ScenarioType,
  attribution?: AttributionPoint[],
): Promise<string> {
  return explainForecast({ points, attribution, weather, scenario });
}
