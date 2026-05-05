import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface CachedWeatherRow {
  timestamp: string;
  ghi: number | null;
  cloudCover: number | null;
  temperature: number | null;
  windSpeed: number | null;
  windDirection: number | null;
  humidity: number | null;
  source: "OPEN_METEO" | "FALLBACK_MOCK";
}

export interface CachedWeatherFile {
  plantCode: string;
  fetchedAt: string;
  source: "OPEN_METEO" | "FALLBACK_MOCK";
  rows: CachedWeatherRow[];
}

export function readWeatherFile(plantCode: string): CachedWeatherFile | null {
  const path = join(process.cwd(), "data", "real-weather", `${plantCode}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as CachedWeatherFile;
  } catch {
    return null;
  }
}
