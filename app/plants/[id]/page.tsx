import Link from "next/link";
import { Badge, Card, Title } from "@tremor/react";
import { PlantDetailTabs } from "@/components/plant-detail-tabs";
import { db } from "@/lib/db";
import { explainForecastVariance } from "@/lib/ai";
import type { ForecastPoint } from "@/lib/types";

async function getPlantData(id: string) {
  const plant = await db.plant.findUnique({ where: { id } });
  if (!plant) return null;

  const generation = await db.generation.findMany({
    where: { plantId: id },
    orderBy: { timestamp: "asc" },
    take: 24 * 30,
  });
  const weather = await db.weatherReading.findMany({
    where: { plantId: id },
    orderBy: { timestamp: "asc" },
    take: 24 * 30,
  });

  const [base, optimistic, pessimistic] = await Promise.all([
    db.forecast.findFirst({ where: { plantId: id, forHorizon: "DAY_AHEAD", scenario: "BASE" }, orderBy: { issuedAt: "desc" } }),
    db.forecast.findFirst({ where: { plantId: id, forHorizon: "DAY_AHEAD", scenario: "OPTIMISTIC" }, orderBy: { issuedAt: "desc" } }),
    db.forecast.findFirst({ where: { plantId: id, forHorizon: "DAY_AHEAD", scenario: "PESSIMISTIC" }, orderBy: { issuedAt: "desc" } }),
  ]);

  const parse = (payload: string | null | undefined): ForecastPoint[] =>
    payload
      ? (JSON.parse(payload) as Array<{ timestamp: string; forecastMW: number; lowerBoundMW: number; upperBoundMW: number }>).map((row) => ({
          timestamp: new Date(row.timestamp),
          forecastMW: row.forecastMW,
          lowerBoundMW: row.lowerBoundMW,
          upperBoundMW: row.upperBoundMW,
        }))
      : [];

  const basePoints = parse(base?.points);
  const optimisticPoints = parse(optimistic?.points);
  const pessimisticPoints = parse(pessimistic?.points);
  const explanation = await explainForecastVariance(basePoints, weather.slice(-24), "BASE");

  const accuracy = await db.forecastAccuracy.findMany({
    where: { plantId: id },
    orderBy: { computedAt: "desc" },
    take: 30,
  });
  const alerts = await db.alert.findMany({ where: { plantId: id }, orderBy: { createdAt: "desc" }, take: 30 });

  return { plant, generation, weather, base, basePoints, optimisticPoints, pessimisticPoints, explanation, accuracy, alerts };
}

export default async function PlantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getPlantData(id);
  if (!data) {
    return (
      <Card>
        <p className="text-tremor-content">Plant not found.</p>
      </Card>
    );
  }

  const historyChart = data.generation.slice(-24 * 14).map((row) => ({
    time: new Date(row.timestamp).toISOString().slice(5, 16).replace("T", " "),
    Actual: row.actualMW,
    Curtailment: row.curtailedMW,
  }));

  const forecastChart = data.basePoints.map((point, idx) => ({
    time: point.timestamp.toISOString().slice(5, 16).replace("T", " "),
    Actual: data.generation[data.generation.length - data.basePoints.length + idx]?.actualMW ?? null,
    Base: point.forecastMW,
    Optimistic: data.optimisticPoints[idx]?.forecastMW ?? null,
    Pessimistic: data.pessimisticPoints[idx]?.forecastMW ?? null,
    Lower: point.lowerBoundMW,
    Upper: point.upperBoundMW,
  }));

  const weatherChart = data.weather.slice(-24 * 7).map((row) => ({
    time: new Date(row.timestamp).toISOString().slice(5, 16).replace("T", " "),
    GHI: row.ghi ?? 0,
    Cloud: (row.cloudCover ?? 0) * 100,
    Temp: row.temperature ?? 0,
    Wind: row.windSpeed ?? 0,
  }));

  const mape7 = data.accuracy.slice(0, 7).reduce((sum, a) => sum + a.mape, 0) / Math.max(data.accuracy.slice(0, 7).length, 1);
  const mape30 = data.accuracy.reduce((sum, a) => sum + a.mape, 0) / Math.max(data.accuracy.length, 1);
  const rmse30 = data.accuracy.reduce((sum, a) => sum + a.rmse, 0) / Math.max(data.accuracy.length, 1);
  const mbe30 = data.accuracy.reduce((sum, a) => sum + a.mbe, 0) / Math.max(data.accuracy.length, 1);

  return (
    <div className="space-y-4">
      <Link href="/plants" className="text-sm font-medium text-orange-700 hover:text-orange-800">
        ← Back to plants
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Title>{data.plant.name}</Title>
          <p className="text-sm text-tremor-content">
            {data.plant.code} · {data.plant.type} · {data.plant.capacityMW.toFixed(1)} MW · {data.plant.district}
          </p>
        </div>
        <Badge color={data.plant.status === "OFFLINE" ? "red" : data.plant.status === "MAINTENANCE" ? "orange" : "emerald"}>
          {data.plant.status}
        </Badge>
      </div>

      <PlantDetailTabs
        plantType={data.plant.type}
        baseMeanConfidence={data.base?.meanConfidence ?? 0}
        baseModelVersion={data.base?.modelVersion ?? "sv-0.2"}
        explanation={data.explanation}
        forecastChart={forecastChart}
        historyChart={historyChart}
        weatherChart={weatherChart}
        mape7={mape7}
        mape30={mape30}
        rmse30={rmse30}
        mbe30={mbe30}
        accuracy={data.accuracy.map((a) => ({
          id: a.id,
          computedAt: a.computedAt.toISOString(),
          mape: a.mape,
          rmse: a.rmse,
          mbe: a.mbe,
          sampleSize: a.sampleSize,
        }))}
        alerts={data.alerts.map((a) => ({
          id: a.id,
          title: a.title,
          description: a.description,
          type: a.type,
          severity: a.severity,
          acknowledged: a.acknowledged,
          createdAt: a.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
