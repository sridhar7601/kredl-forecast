import { faker } from "@faker-js/faker";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildPlantRows } from "./generate-mock-plants";

faker.seed(42);

export interface MockGenerationRow {
  plantCode: string;
  timestamp: string;
  actualMW: number;
  availableMW: number;
  curtailedMW: number;
}

export interface MockWeatherRow {
  plantCode: string;
  timestamp: string;
  ghi: number | null;
  cloudCover: number | null;
  temperature: number | null;
  windSpeed: number | null;
  windDirection: number | null;
  humidity: number | null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function generateTimeseries(days = 90): { generation: MockGenerationRow[]; weather: MockWeatherRow[] } {
  const plants = buildPlantRows();
  const generation: MockGenerationRow[] = [];
  const weather: MockWeatherRow[] = [];
  const now = new Date();

  for (const plant of plants) {
    for (let d = days; d >= -7; d -= 1) {
      for (let h = 0; h < 24; h += 1) {
        const ts = new Date(now.getTime() - d * 24 * 3600 * 1000);
        ts.setHours(h, 0, 0, 0);
        const dayFactor = 0.9 + 0.2 * Math.sin((2 * Math.PI * d) / 14);
        const random = faker.number.float({ min: 0.9, max: 1.1 });

        if (plant.type === "SOLAR_PV") {
          const hourAngle = Math.sin(Math.PI * (h - 6) / 12);
          const diurnal = clamp(hourAngle, 0, 1);
          const cloudCover = clamp(faker.number.float({ min: 0.05, max: 0.95 }) * (0.8 + 0.4 * (1 - diurnal)), 0, 1);
          const temperature = 22 + 14 * diurnal + faker.number.float({ min: -2, max: 2 });
          const ghi = Math.max(0, 950 * diurnal * (1 - 0.5 * cloudCover));
          const availableMW = plant.capacityMW * diurnal * dayFactor * random;
          const curtailmentEvent = d % 17 === 0 && h >= 12 && h <= 14;
          const curtailedMW = curtailmentEvent ? availableMW * faker.number.float({ min: 0.12, max: 0.22 }) : 0;
          const actualMW = Math.max(0, availableMW - curtailedMW);
          weather.push({
            plantCode: plant.code,
            timestamp: ts.toISOString(),
            ghi: Number(ghi.toFixed(2)),
            cloudCover: Number(cloudCover.toFixed(3)),
            temperature: Number(temperature.toFixed(2)),
            windSpeed: Number(faker.number.float({ min: 1.5, max: 8.5 }).toFixed(2)),
            windDirection: faker.number.int({ min: 0, max: 359 }),
            humidity: Number(faker.number.float({ min: 0.3, max: 0.88 }).toFixed(2)),
          });
          generation.push({
            plantCode: plant.code,
            timestamp: ts.toISOString(),
            actualMW: Number(actualMW.toFixed(2)),
            availableMW: Number(availableMW.toFixed(2)),
            curtailedMW: Number(curtailedMW.toFixed(2)),
          });
        } else {
          const windSpeed = clamp(7 + 3 * Math.sin((2 * Math.PI * (h + d)) / 24) + faker.number.float({ min: -2, max: 2 }), 0, 28);
          const powerFraction = windSpeed < 3 ? 0 : windSpeed < 12 ? ((windSpeed - 3) / 9) ** 2 : windSpeed <= 25 ? 1 : 0;
          const availableMW = plant.capacityMW * powerFraction * dayFactor;
          const curtailedMW = d % 21 === 0 && h >= 1 && h <= 3 ? availableMW * 0.15 : 0;
          const actualMW = Math.max(0, availableMW - curtailedMW);
          weather.push({
            plantCode: plant.code,
            timestamp: ts.toISOString(),
            ghi: null,
            cloudCover: Number(faker.number.float({ min: 0.1, max: 0.9 }).toFixed(3)),
            temperature: Number(faker.number.float({ min: 18, max: 34 }).toFixed(2)),
            windSpeed: Number(windSpeed.toFixed(2)),
            windDirection: faker.number.int({ min: 0, max: 359 }),
            humidity: Number(faker.number.float({ min: 0.35, max: 0.92 }).toFixed(2)),
          });
          generation.push({
            plantCode: plant.code,
            timestamp: ts.toISOString(),
            actualMW: Number(actualMW.toFixed(2)),
            availableMW: Number(availableMW.toFixed(2)),
            curtailedMW: Number(curtailedMW.toFixed(2)),
          });
        }
      }
    }
  }

  return { generation, weather };
}

if (process.argv[1]?.includes("generate-mock-timeseries.ts")) {
  const rows = generateTimeseries(90);
  const outDir = join(process.cwd(), "data");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "mock-generation.json"), JSON.stringify(rows.generation, null, 2));
  writeFileSync(join(outDir, "mock-weather.json"), JSON.stringify(rows.weather, null, 2));
  // eslint-disable-next-line no-console
  console.log(`Wrote ${rows.generation.length} generation rows and ${rows.weather.length} weather rows`);
}
