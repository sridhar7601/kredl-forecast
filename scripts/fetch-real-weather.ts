import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { MOCK_PLANTS } from "./generate-mock-plants";
import { readWeatherFile as readWeatherFileImpl, type CachedWeatherFile, type CachedWeatherRow } from "../lib/weather-cache";

export type RealWeatherRow = CachedWeatherRow;
export type PlantWeatherFile = CachedWeatherFile;
export const readWeatherFile = readWeatherFileImpl;

// Open-Meteo: https://open-meteo.com — no API key, free for non-commercial use.
// Archive endpoint serves historical hourly weather; forecast endpoint serves the
// next 7 days. We cache to disk so the demo machine never depends on live network
// during judging.

const ARCHIVE = "https://archive-api.open-meteo.com/v1/archive";
const FORECAST = "https://api.open-meteo.com/v1/forecast";

const HOURLY_VARS = [
  "shortwave_radiation",
  "cloud_cover",
  "temperature_2m",
  "wind_speed_10m",
  "wind_direction_10m",
  "relative_humidity_2m",
].join(",");

interface OpenMeteoHourly {
  time: string[];
  shortwave_radiation?: (number | null)[];
  cloud_cover?: (number | null)[];
  temperature_2m?: (number | null)[];
  wind_speed_10m?: (number | null)[];
  wind_direction_10m?: (number | null)[];
  relative_humidity_2m?: (number | null)[];
}

interface OpenMeteoResponse {
  hourly?: OpenMeteoHourly;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function normaliseRows(hourly: OpenMeteoHourly | undefined, source: RealWeatherRow["source"]): RealWeatherRow[] {
  if (!hourly?.time) return [];
  return hourly.time.map((t, i) => ({
    timestamp: new Date(`${t}:00Z`).toISOString(),
    ghi: hourly.shortwave_radiation?.[i] ?? null,
    cloudCover:
      hourly.cloud_cover?.[i] !== undefined && hourly.cloud_cover?.[i] !== null
        ? Number(((hourly.cloud_cover[i] as number) / 100).toFixed(3))
        : null,
    temperature: hourly.temperature_2m?.[i] ?? null,
    windSpeed:
      hourly.wind_speed_10m?.[i] !== undefined && hourly.wind_speed_10m?.[i] !== null
        ? Number(((hourly.wind_speed_10m[i] as number) / 3.6).toFixed(2)) // km/h → m/s
        : null,
    windDirection: hourly.wind_direction_10m?.[i] ?? null,
    humidity:
      hourly.relative_humidity_2m?.[i] !== undefined && hourly.relative_humidity_2m?.[i] !== null
        ? Number(((hourly.relative_humidity_2m[i] as number) / 100).toFixed(2))
        : null,
    source,
  }));
}

async function fetchOne(url: string): Promise<OpenMeteoResponse> {
  const res = await fetch(url, { headers: { "User-Agent": "SuryaVayu-AI/0.3 (hackathon-demo)" } });
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  return (await res.json()) as OpenMeteoResponse;
}

async function fetchPlantWeather(lat: number, lng: number): Promise<RealWeatherRow[]> {
  const today = new Date();
  const start = new Date(today.getTime() - 90 * 24 * 3600 * 1000);
  // Archive lags ~5 days behind real-time, so cap historical end 5 days ago.
  const archiveEnd = new Date(today.getTime() - 5 * 24 * 3600 * 1000);

  const archiveUrl =
    `${ARCHIVE}?latitude=${lat}&longitude=${lng}` +
    `&start_date=${isoDate(start)}&end_date=${isoDate(archiveEnd)}` +
    `&hourly=${HOURLY_VARS}&timezone=UTC`;

  const forecastUrl =
    `${FORECAST}?latitude=${lat}&longitude=${lng}` +
    `&hourly=${HOURLY_VARS}&past_days=7&forecast_days=7&timezone=UTC`;

  const [archive, forecast] = await Promise.all([fetchOne(archiveUrl), fetchOne(forecastUrl)]);
  const archiveRows = normaliseRows(archive.hourly, "OPEN_METEO");
  const forecastRows = normaliseRows(forecast.hourly, "OPEN_METEO");

  // dedupe by timestamp; forecast wins for overlapping hours (it's closer to "now")
  const merged = new Map<string, RealWeatherRow>();
  for (const row of archiveRows) merged.set(row.timestamp, row);
  for (const row of forecastRows) merged.set(row.timestamp, row);
  return Array.from(merged.values()).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

async function main(): Promise<void> {
  const outDir = join(process.cwd(), "data", "real-weather");
  mkdirSync(outDir, { recursive: true });
  const force = process.argv.includes("--force");

  let okCount = 0;
  let fallbackCount = 0;

  for (const plant of MOCK_PLANTS) {
    const path = join(outDir, `${plant.code}.json`);
    if (existsSync(path) && !force) {
      // eslint-disable-next-line no-console
      console.log(`[skip] ${plant.code} cached at ${path}`);
      okCount += 1;
      continue;
    }

    try {
      const rows = await fetchPlantWeather(plant.lat, plant.lng);
      const file: PlantWeatherFile = {
        plantCode: plant.code,
        fetchedAt: new Date().toISOString(),
        source: "OPEN_METEO",
        rows,
      };
      writeFileSync(path, JSON.stringify(file, null, 2));
      // eslint-disable-next-line no-console
      console.log(`[ok]   ${plant.code} ${rows.length} hourly rows from Open-Meteo`);
      okCount += 1;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[warn] ${plant.code} Open-Meteo failed: ${(err as Error).message}; will fall back to mock at seed time.`);
      const file: PlantWeatherFile = {
        plantCode: plant.code,
        fetchedAt: new Date().toISOString(),
        source: "FALLBACK_MOCK",
        rows: [],
      };
      writeFileSync(path, JSON.stringify(file, null, 2));
      fallbackCount += 1;
    }
  }

  // eslint-disable-next-line no-console
  console.log(`Done. ${okCount} plants from Open-Meteo, ${fallbackCount} fell back to mock.`);
}

if (process.argv[1]?.includes("fetch-real-weather.ts")) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
