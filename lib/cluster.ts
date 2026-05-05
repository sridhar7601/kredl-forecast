import { db } from "@/lib/db";
import { parseForecastPoints } from "@/lib/data";
import type { ClusterSummary, ForecastHorizon, ForecastPoint, PlantType, ScenarioType } from "@/lib/types";

// Cluster := plants grouped by (district, type). KREDL/KSPDCL operate at this granularity
// for dispatch and curtailment planning, so we expose it as a first-class view.
// Cluster-level forecast = hourly-aligned sum of constituent plant forecasts.
// Confidence band aggregation uses sum-of-variances (independence assumption).

export function clusterIdFor(district: string, type: string): string {
  return `${district.toUpperCase().replace(/\s+/g, "-")}-${type}`;
}

export async function listClusters(): Promise<ClusterSummary[]> {
  const plants = await db.plant.findMany({
    select: { id: true, district: true, type: true, capacityMW: true },
  });
  const buckets = new Map<string, ClusterSummary>();
  for (const p of plants) {
    const id = clusterIdFor(p.district, p.type);
    const existing = buckets.get(id);
    if (existing) {
      existing.plantCount += 1;
      existing.totalCapacityMW += p.capacityMW;
      existing.plantIds.push(p.id);
    } else {
      buckets.set(id, {
        id,
        district: p.district,
        type: p.type as PlantType,
        plantCount: 1,
        totalCapacityMW: p.capacityMW,
        plantIds: [p.id],
      });
    }
  }
  return Array.from(buckets.values()).sort((a, b) => b.totalCapacityMW - a.totalCapacityMW);
}

export async function getCluster(id: string): Promise<ClusterSummary | null> {
  const all = await listClusters();
  return all.find((c) => c.id === id) ?? null;
}

export interface ClusterForecast {
  cluster: ClusterSummary;
  horizon: ForecastHorizon;
  scenario: ScenarioType;
  points: ForecastPoint[];
  meanConfidence: number;
}

export async function aggregateClusterForecast(
  clusterId: string,
  horizon: ForecastHorizon,
  scenario: ScenarioType,
): Promise<ClusterForecast | null> {
  const cluster = await getCluster(clusterId);
  if (!cluster) return null;

  const forecasts = await db.forecast.findMany({
    where: {
      plantId: { in: cluster.plantIds },
      forHorizon: horizon,
      scenario,
    },
    orderBy: { issuedAt: "desc" },
  });

  // keep latest per plant
  const latestByPlant = new Map<string, (typeof forecasts)[number]>();
  for (const f of forecasts) {
    if (!latestByPlant.has(f.plantId)) latestByPlant.set(f.plantId, f);
  }

  type Bucket = { mw: number; lower: number; upperVar: number; lowerVar: number };
  const buckets = new Map<number, Bucket>();
  let confidenceSum = 0;
  let confidenceCount = 0;

  for (const f of latestByPlant.values()) {
    const points = parseForecastPoints(f.points);
    confidenceSum += f.meanConfidence;
    confidenceCount += 1;
    for (const p of points) {
      const ts = new Date(p.timestamp).getTime();
      const cur = buckets.get(ts) ?? { mw: 0, lower: 0, upperVar: 0, lowerVar: 0 };
      cur.mw += p.forecastMW;
      // Sum of variances: store half-spread^2 per plant, sum, then sqrt at the end.
      const upperHalfSpread = Math.max(0, p.upperBoundMW - p.forecastMW);
      const lowerHalfSpread = Math.max(0, p.forecastMW - p.lowerBoundMW);
      cur.upperVar += upperHalfSpread * upperHalfSpread;
      cur.lowerVar += lowerHalfSpread * lowerHalfSpread;
      buckets.set(ts, cur);
    }
  }

  const points: ForecastPoint[] = Array.from(buckets.entries())
    .sort(([a], [b]) => a - b)
    .map(([ts, b]) => ({
      timestamp: new Date(ts),
      forecastMW: Number(b.mw.toFixed(2)),
      lowerBoundMW: Number((b.mw - Math.sqrt(b.lowerVar)).toFixed(2)),
      upperBoundMW: Number((b.mw + Math.sqrt(b.upperVar)).toFixed(2)),
    }));

  return {
    cluster,
    horizon,
    scenario,
    points,
    meanConfidence: confidenceCount === 0 ? 0 : Number((confidenceSum / confidenceCount).toFixed(2)),
  };
}

export interface ClusterAccuracy {
  cluster: ClusterSummary;
  weightedMape: number;
  weightedRmse: number;
  weightedMbe: number;
  sampleSize: number;
}

export async function aggregateClusterAccuracy(clusterId: string): Promise<ClusterAccuracy | null> {
  const cluster = await getCluster(clusterId);
  if (!cluster) return null;

  const plants = await db.plant.findMany({
    where: { id: { in: cluster.plantIds } },
    select: { id: true, capacityMW: true },
  });
  const capacityById = new Map(plants.map((p) => [p.id, p.capacityMW]));

  const accuracy = await db.forecastAccuracy.findMany({
    where: { plantId: { in: cluster.plantIds } },
    orderBy: { computedAt: "desc" },
    take: 50 * cluster.plantIds.length,
  });

  // average each plant's most-recent accuracy weighted by capacity
  const latestByPlant = new Map<string, (typeof accuracy)[number]>();
  for (const a of accuracy) {
    if (!latestByPlant.has(a.plantId)) latestByPlant.set(a.plantId, a);
  }

  let totalWeight = 0;
  let mapeSum = 0;
  let rmseSum = 0;
  let mbeSum = 0;
  let sampleSize = 0;
  for (const a of latestByPlant.values()) {
    const weight = capacityById.get(a.plantId) ?? 1;
    totalWeight += weight;
    mapeSum += a.mape * weight;
    rmseSum += a.rmse * weight;
    mbeSum += a.mbe * weight;
    sampleSize += a.sampleSize;
  }

  if (totalWeight === 0) {
    return {
      cluster,
      weightedMape: 0,
      weightedRmse: 0,
      weightedMbe: 0,
      sampleSize: 0,
    };
  }

  return {
    cluster,
    weightedMape: Number((mapeSum / totalWeight).toFixed(2)),
    weightedRmse: Number((rmseSum / totalWeight).toFixed(2)),
    weightedMbe: Number((mbeSum / totalWeight).toFixed(2)),
    sampleSize,
  };
}
