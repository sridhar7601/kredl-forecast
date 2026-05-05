import type { GenerationPoint } from "@/lib/types";
import { computeMAPE } from "@/lib/metrics";

export type BaselineKind = "PERSISTENCE" | "SEASONAL_NAIVE";

// Persistence: forecast[t] = actual[t - 24h].
// Seasonal-naive: forecast[t] = actual[t - 168h] (same hour last week).
// Both work directly off the historical generation series with no fitting.

function alignByTimestamp(history: GenerationPoint[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const row of history) {
    map.set(new Date(row.timestamp).getTime(), row.actualMW);
  }
  return map;
}

export function persistenceForecast(history: GenerationPoint[], targets: Date[]): number[] {
  const lookup = alignByTimestamp(history);
  return targets.map((t) => {
    const lagged = t.getTime() - 24 * 60 * 60 * 1000;
    return lookup.get(lagged) ?? 0;
  });
}

export function seasonalNaiveForecast(history: GenerationPoint[], targets: Date[]): number[] {
  const lookup = alignByTimestamp(history);
  return targets.map((t) => {
    const lagged = t.getTime() - 168 * 60 * 60 * 1000;
    return lookup.get(lagged) ?? 0;
  });
}

export interface BaselineCompareInput {
  history: GenerationPoint[];
  actual: GenerationPoint[];
  ourPredicted: number[];
}

export interface BaselineCompareResult {
  ourMape: number;
  persistenceMape: number;
  seasonalNaiveMape: number;
  improvementVsPersistencePct: number;
  improvementVsSeasonalNaivePct: number;
  sampleSize: number;
}

export function compareToBaselines(input: BaselineCompareInput): BaselineCompareResult {
  const targets = input.actual.map((row) => new Date(row.timestamp));
  const actualValues = input.actual.map((row) => row.actualMW);
  const persistencePred = persistenceForecast(input.history, targets);
  const seasonalPred = seasonalNaiveForecast(input.history, targets);

  const ourMape = Number(computeMAPE(actualValues, input.ourPredicted).toFixed(2));
  const persistenceMape = Number(computeMAPE(actualValues, persistencePred).toFixed(2));
  const seasonalNaiveMape = Number(computeMAPE(actualValues, seasonalPred).toFixed(2));

  const improvementVsPersistencePct = persistenceMape === 0
    ? 0
    : Number((((persistenceMape - ourMape) / persistenceMape) * 100).toFixed(2));
  const improvementVsSeasonalNaivePct = seasonalNaiveMape === 0
    ? 0
    : Number((((seasonalNaiveMape - ourMape) / seasonalNaiveMape) * 100).toFixed(2));

  return {
    ourMape,
    persistenceMape,
    seasonalNaiveMape,
    improvementVsPersistencePct,
    improvementVsSeasonalNaivePct,
    sampleSize: actualValues.length,
  };
}
