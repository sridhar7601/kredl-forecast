import type {
  AttributionPoint,
  ForecastHorizon,
  ForecastInput,
  ForecastPoint,
  GenerationPoint,
  PlantType,
  ScenarioType,
  WeatherPoint,
} from "@/lib/types";

// Single feature-conditioned forecast model. plantType is a feature, not a model selector:
// the same forecastFeatures() pipeline runs for every asset, branching only on physics
// (irradiance vs power-curve). No separate weights, no separate runtime, no separate eval.

export const MODEL_VERSION = "sv-0.3";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function scenarioMultiplier(scenario: ScenarioType): number {
  if (scenario === "OPTIMISTIC") return 1.08;
  if (scenario === "PESSIMISTIC") return 0.88;
  return 1;
}

function horizonHours(horizon: ForecastHorizon): number {
  if (horizon === "INTRADAY_6H") return 6;
  if (horizon === "DAY_AHEAD") return 24;
  return 24 * 7;
}

function hourlyDiurnalProfile(history: GenerationPoint[], capacityMW: number): number[] {
  const buckets = Array.from({ length: 24 }, () => ({ sum: 0, count: 0 }));
  for (const point of history) {
    const hour = new Date(point.timestamp).getHours();
    buckets[hour].sum += clamp(point.actualMW / Math.max(capacityMW, 0.1), 0, 1.2);
    buckets[hour].count += 1;
  }
  return buckets.map((b) => (b.count > 0 ? b.sum / b.count : 0));
}

function weatherByTimestamp(weather: WeatherPoint[]): Map<number, WeatherPoint> {
  const map = new Map<number, WeatherPoint>();
  for (const w of weather) {
    map.set(new Date(w.timestamp).getTime(), w);
  }
  return map;
}

function avg<T>(arr: T[], pick: (v: T) => number): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, x) => s + pick(x), 0) / arr.length;
}

function windPowerFraction(speedMS: number): number {
  if (speedMS < 3) return 0;
  if (speedMS < 12) return Math.pow((speedMS - 3) / 9, 2);
  if (speedMS <= 25) return 1;
  return 0;
}

function confidenceSpread(basePct: number, step: number, horizon: ForecastHorizon): number {
  const widening = horizon === "WEEK" ? 0.0025 : horizon === "DAY_AHEAD" ? 0.0012 : 0.0008;
  return basePct + widening * step;
}

export interface FeatureVector {
  plantType: PlantType;
  capacityMW: number;
  hourOfDay: number;
  diurnalNorm: number;
  ghi: number;
  cloudCover: number;
  temperature: number;
  windSpeed: number;
  scenario: ScenarioType;
}

export interface ForecastBreakdown {
  finalMW: number;
  baselineMW: number;
  cloudPenaltyMW: number;
  tempDeratingMW: number;
  windFactorMW: number;
  scenarioAdjustmentMW: number;
}

export function forecastFeatures(features: FeatureVector): ForecastBreakdown {
  const { plantType, capacityMW, diurnalNorm, cloudCover, temperature, windSpeed, scenario } = features;

  if (plantType === "SOLAR_PV") {
    const baselineMW = clamp(diurnalNorm * capacityMW, 0, capacityMW * 1.05);
    const cloudPenaltyMW = clamp(baselineMW * 0.6 * cloudCover, 0, baselineMW);
    const tempDeratingMW = clamp(baselineMW * 0.004 * Math.max(0, temperature - 25), 0, baselineMW);
    const preScenario = clamp(baselineMW - cloudPenaltyMW - tempDeratingMW, 0, capacityMW * 1.05);
    const scenarioAdjustmentMW = preScenario * (scenarioMultiplier(scenario) - 1);
    const finalMW = clamp(preScenario + scenarioAdjustmentMW, 0, capacityMW * 1.05);
    return {
      finalMW,
      baselineMW: Number(baselineMW.toFixed(3)),
      cloudPenaltyMW: Number(cloudPenaltyMW.toFixed(3)),
      tempDeratingMW: Number(tempDeratingMW.toFixed(3)),
      windFactorMW: 0,
      scenarioAdjustmentMW: Number(scenarioAdjustmentMW.toFixed(3)),
    };
  }

  // WIND
  const fraction = windPowerFraction(windSpeed);
  const baselineMW = capacityMW; // rated baseline
  const windFactorMW = -clamp(baselineMW * (1 - fraction), 0, baselineMW);
  const cloudPenaltyMW = 0;
  const tempDeratingMW = 0;
  const preScenario = clamp(baselineMW + windFactorMW, 0, baselineMW);
  const scenarioAdjustmentMW = preScenario * (scenarioMultiplier(scenario) - 1);
  const finalMW = clamp(preScenario + scenarioAdjustmentMW, 0, capacityMW * 1.05);
  return {
    finalMW,
    baselineMW: Number(baselineMW.toFixed(3)),
    cloudPenaltyMW: 0,
    tempDeratingMW: 0,
    windFactorMW: Number(windFactorMW.toFixed(3)),
    scenarioAdjustmentMW: Number(scenarioAdjustmentMW.toFixed(3)),
  };
}

export interface GenerateForecastResult {
  points: ForecastPoint[];
  attribution: AttributionPoint[];
  meanConfidence: number;
  modelVersion: string;
}

export function generateForecast(input: ForecastInput): GenerateForecastResult {
  const totalHours = horizonHours(input.horizon);
  const anchor =
    input.weatherForecast.length > 0
      ? new Date(input.weatherForecast[0].timestamp)
      : new Date(Math.floor(Date.now() / 3600000) * 3600000);
  const weatherMap = weatherByTimestamp(input.weatherForecast);
  const profile = hourlyDiurnalProfile(input.history, input.capacityMW);
  const baseSpread = input.plantType === "WIND" ? 0.16 : 0.1;

  const points: ForecastPoint[] = [];
  const attribution: AttributionPoint[] = [];

  for (let i = 0; i < totalHours; i += 1) {
    const timestamp = new Date(anchor.getTime() + i * 60 * 60 * 1000);
    const weather = weatherMap.get(timestamp.getTime());
    const hour = timestamp.getHours();

    const features: FeatureVector = {
      plantType: input.plantType,
      capacityMW: input.capacityMW,
      hourOfDay: hour,
      diurnalNorm: profile[hour] ?? 0,
      ghi: weather?.ghi ?? 0,
      cloudCover: clamp(weather?.cloudCover ?? 0.25, 0, 1),
      temperature: weather?.temperature ?? 28,
      windSpeed: weather?.windSpeed ?? 6.5,
      scenario: input.scenario,
    };

    const breakdown = forecastFeatures(features);
    const forecastMW = breakdown.finalMW;
    const spreadPct = confidenceSpread(baseSpread, i, input.horizon);
    const lowerBoundMW = clamp(forecastMW * (1 - spreadPct), 0, input.capacityMW);
    const upperBoundMW = clamp(forecastMW * (1 + spreadPct), 0, input.capacityMW * 1.1);

    points.push({
      timestamp,
      forecastMW: Number(forecastMW.toFixed(2)),
      lowerBoundMW: Number(lowerBoundMW.toFixed(2)),
      upperBoundMW: Number(upperBoundMW.toFixed(2)),
    });

    attribution.push({
      timestamp,
      baselineMW: breakdown.baselineMW,
      cloudPenaltyMW: breakdown.cloudPenaltyMW,
      tempDeratingMW: breakdown.tempDeratingMW,
      windFactorMW: breakdown.windFactorMW,
      scenarioAdjustmentMW: breakdown.scenarioAdjustmentMW,
      finalMW: Number(forecastMW.toFixed(3)),
    });
  }

  const cloudAvg = avg(input.weatherForecast, (w) => w.cloudCover ?? 0.2);
  const windVol = avg(input.weatherForecast, (w) => Math.abs((w.windSpeed ?? 6) - 6));
  const baseConfidence = input.plantType === "SOLAR_PV" ? 0.9 : 0.84;
  const weatherPenalty = input.plantType === "SOLAR_PV" ? cloudAvg * 0.2 : windVol * 0.03;
  const horizonPenalty = input.horizon === "WEEK" ? 0.12 : input.horizon === "DAY_AHEAD" ? 0.07 : 0.04;
  const meanConfidence = clamp(baseConfidence - weatherPenalty - horizonPenalty, 0.55, 0.98);

  return {
    points,
    attribution,
    meanConfidence: Number(meanConfidence.toFixed(2)),
    modelVersion: MODEL_VERSION,
  };
}

export function buildBaselineForecast(
  plantType: PlantType,
  capacityMW: number,
  history: GenerationPoint[],
  weatherForecast: WeatherPoint[],
  horizon: ForecastHorizon,
): ForecastPoint[] {
  return generateForecast({
    plantId: "preview",
    plantType,
    capacityMW,
    history,
    weatherHistory: [],
    weatherForecast,
    horizon,
    scenario: "BASE",
  }).points;
}
