import { faker } from "@faker-js/faker";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildPlantRows } from "./generate-mock-plants";
import { generateTimeseries as generateMockTimeseries, type MockGenerationRow, type MockWeatherRow } from "./generate-mock-timeseries";
import { readWeatherFile, type RealWeatherRow } from "./fetch-real-weather";
import { forecastFeatures } from "../lib/forecast";
import type { PlantType } from "../lib/types";

faker.seed(42);

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// Real-weather-driven generation: we use cached Open-Meteo readings as the weather
// source of truth, and synthesize plant-level generation by running the same
// physics-grounded forecast pipeline plus a small noise term. This makes the demo
// numbers self-consistent (real cloud cover → realistic dip in solar output) and
// keeps generation honestly synthetic since we don't have real SCADA data.

function diurnalProfile(plantType: PlantType): number[] {
  if (plantType === "WIND") return Array.from({ length: 24 }, () => 0.5);
  return Array.from({ length: 24 }, (_, h) => clamp(Math.sin((Math.PI * (h - 6)) / 12), 0, 1));
}

function noise(): number {
  return 0.92 + faker.number.float({ min: 0, max: 0.16 });
}

export function generateRealDrivenTimeseries(): {
  generation: MockGenerationRow[];
  weather: MockWeatherRow[];
  realPlants: number;
  fallbackPlants: number;
} {
  const plants = buildPlantRows();
  const generation: MockGenerationRow[] = [];
  const weather: MockWeatherRow[] = [];
  let realPlants = 0;
  let fallbackPlants = 0;

  for (const plant of plants) {
    const cached = readWeatherFile(plant.code);
    const realRows: RealWeatherRow[] = cached?.source === "OPEN_METEO" && cached.rows.length > 0 ? cached.rows : [];

    if (realRows.length === 0) {
      fallbackPlants += 1;
      continue;
    }

    realPlants += 1;
    const profile = diurnalProfile(plant.type as PlantType);

    for (const row of realRows) {
      const ts = new Date(row.timestamp);
      const hour = ts.getHours();
      const breakdown = forecastFeatures({
        plantType: plant.type as PlantType,
        capacityMW: plant.capacityMW,
        hourOfDay: hour,
        diurnalNorm: profile[hour] ?? 0,
        ghi: row.ghi ?? 0,
        cloudCover: row.cloudCover ?? 0.25,
        temperature: row.temperature ?? 28,
        windSpeed: row.windSpeed ?? 6.5,
        scenario: "BASE",
      });

      const availableMW = clamp(breakdown.finalMW * noise(), 0, plant.capacityMW * 1.05);
      // sprinkle a few curtailment events on solar plants between noon and 14h
      const isCurtailWindow = plant.type === "SOLAR_PV" && hour >= 12 && hour <= 14 && ts.getDate() % 17 === 0;
      const curtailedMW = isCurtailWindow ? availableMW * faker.number.float({ min: 0.12, max: 0.22 }) : 0;
      const actualMW = Math.max(0, availableMW - curtailedMW);

      generation.push({
        plantCode: plant.code,
        timestamp: ts.toISOString(),
        actualMW: Number(actualMW.toFixed(2)),
        availableMW: Number(availableMW.toFixed(2)),
        curtailedMW: Number(curtailedMW.toFixed(2)),
      });

      weather.push({
        plantCode: plant.code,
        timestamp: ts.toISOString(),
        ghi: row.ghi !== null ? Number(row.ghi.toFixed(2)) : null,
        cloudCover: row.cloudCover !== null ? Number(row.cloudCover.toFixed(3)) : null,
        temperature: row.temperature !== null ? Number(row.temperature.toFixed(2)) : null,
        windSpeed: row.windSpeed !== null ? Number(row.windSpeed.toFixed(2)) : null,
        windDirection: row.windDirection !== null ? Math.round(row.windDirection) : null,
        humidity: row.humidity !== null ? Number(row.humidity.toFixed(2)) : null,
      });
    }
  }

  if (fallbackPlants > 0) {
    // Fill in mock data for plants that don't have a cached Open-Meteo file.
    const mock = generateMockTimeseries(90);
    const realCodes = new Set(generation.map((r) => r.plantCode));
    const filteredGeneration = mock.generation.filter((r) => !realCodes.has(r.plantCode));
    const filteredWeather = mock.weather.filter((r) => !realCodes.has(r.plantCode));
    generation.push(...filteredGeneration);
    weather.push(...filteredWeather);
  }

  return { generation, weather, realPlants, fallbackPlants };
}

if (process.argv[1]?.includes("generate-timeseries.ts")) {
  const out = generateRealDrivenTimeseries();
  const outDir = join(process.cwd(), "data");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "timeseries-generation.json"), JSON.stringify(out.generation, null, 2));
  writeFileSync(join(outDir, "timeseries-weather.json"), JSON.stringify(out.weather, null, 2));
  // eslint-disable-next-line no-console
  console.log(
    `Wrote ${out.generation.length} generation rows + ${out.weather.length} weather rows. ` +
      `Real-weather plants: ${out.realPlants}, fallback (mock) plants: ${out.fallbackPlants}.`,
  );
}
