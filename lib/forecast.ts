import type { ForecastHorizon, ForecastInput, ForecastPoint, GenerationPoint, PlantType, ScenarioType, WeatherPoint } from "@/lib/types";

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

function calculateWindPowerFraction(speedMS: number): number {
  if (speedMS < 3) return 0;
  if (speedMS < 12) return Math.pow((speedMS - 3) / 9, 2);
  if (speedMS <= 25) return 1;
  return 0;
}

function weatherFactorSolar(weather: WeatherPoint | undefined): number {
  const cloud = clamp(weather?.cloudCover ?? 0.25, 0, 1);
  const temp = weather?.temperature ?? 28;
  const penalty = 1 - 0.6 * cloud - 0.004 * Math.max(0, temp - 25);
  return clamp(penalty, 0.05, 1.1);
}

function weatherFactorWind(weather: WeatherPoint | undefined): number {
  const speed = weather?.windSpeed ?? 6.5;
  return clamp(calculateWindPowerFraction(speed), 0, 1.1);
}

function confidenceSpread(basePct: number, step: number, horizon: ForecastHorizon): number {
  const widening = horizon === "WEEK" ? 0.0025 : horizon === "DAY_AHEAD" ? 0.0012 : 0.0008;
  return basePct + widening * step;
}

function forecastPointSolar(
  hourProfile: number[],
  ts: Date,
  weather: WeatherPoint | undefined,
  capacityMW: number,
  scenario: ScenarioType,
): number {
  const hour = ts.getHours();
  const diurnal = hourProfile[hour] ?? 0;
  return clamp(diurnal * weatherFactorSolar(weather) * capacityMW * scenarioMultiplier(scenario), 0, capacityMW * 1.05);
}

function forecastPointWind(
  ts: Date,
  weather: WeatherPoint | undefined,
  capacityMW: number,
  scenario: ScenarioType,
): number {
  const profileWobble = 0.95 + ((ts.getHours() % 6) * 0.01);
  const base = weatherFactorWind(weather) * profileWobble * capacityMW * scenarioMultiplier(scenario);
  return clamp(base, 0, capacityMW * 1.05);
}

export function generateForecast(input: ForecastInput): { points: ForecastPoint[]; meanConfidence: number; modelVersion: string } {
  const totalHours = horizonHours(input.horizon);
  const anchor = input.weatherForecast.length > 0
    ? new Date(input.weatherForecast[0].timestamp)
    : new Date(Math.floor(Date.now() / 3600000) * 3600000);
  const weatherMap = weatherByTimestamp(input.weatherForecast);
  const profile = hourlyDiurnalProfile(input.history, input.capacityMW);
  const baseSpread = input.plantType === "WIND" ? 0.16 : 0.1;
  const points: ForecastPoint[] = [];

  for (let i = 0; i < totalHours; i += 1) {
    const timestamp = new Date(anchor.getTime() + i * 60 * 60 * 1000);
    const weather = weatherMap.get(timestamp.getTime());

    const forecastMW =
      input.plantType === "SOLAR_PV"
        ? forecastPointSolar(profile, timestamp, weather, input.capacityMW, input.scenario)
        : forecastPointWind(timestamp, weather, input.capacityMW, input.scenario);

    const spreadPct = confidenceSpread(baseSpread, i, input.horizon);
    const lowerBoundMW = clamp(forecastMW * (1 - spreadPct), 0, input.capacityMW);
    const upperBoundMW = clamp(forecastMW * (1 + spreadPct), 0, input.capacityMW * 1.1);

    points.push({
      timestamp,
      forecastMW: Number(forecastMW.toFixed(2)),
      lowerBoundMW: Number(lowerBoundMW.toFixed(2)),
      upperBoundMW: Number(upperBoundMW.toFixed(2)),
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
    meanConfidence: Number(meanConfidence.toFixed(2)),
    modelVersion: "sv-0.2",
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
