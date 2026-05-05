import Link from "next/link";
import { Badge, Card, Title } from "@tremor/react";
import { PlantDetailTabs } from "@/components/plant-detail-tabs";
import { db } from "@/lib/db";
import { narrateForecast } from "@/lib/llm-narration";
import { generateForecast } from "@/lib/forecast";
import { compareToBaselines } from "@/lib/baselines";
import { readWeatherFile } from "@/lib/weather-cache";
import type { AttributionPoint, ForecastPoint, PlantType } from "@/lib/types";

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

  const [base, optimistic, pessimistic, intradayBase, weekBase, weekOptimistic, weekPessimistic] =
    await Promise.all([
      db.forecast.findFirst({ where: { plantId: id, forHorizon: "DAY_AHEAD", scenario: "BASE" }, orderBy: { issuedAt: "desc" } }),
      db.forecast.findFirst({ where: { plantId: id, forHorizon: "DAY_AHEAD", scenario: "OPTIMISTIC" }, orderBy: { issuedAt: "desc" } }),
      db.forecast.findFirst({ where: { plantId: id, forHorizon: "DAY_AHEAD", scenario: "PESSIMISTIC" }, orderBy: { issuedAt: "desc" } }),
      db.forecast.findFirst({ where: { plantId: id, forHorizon: "INTRADAY_6H", scenario: "BASE" }, orderBy: { issuedAt: "desc" } }),
      db.forecast.findFirst({ where: { plantId: id, forHorizon: "WEEK", scenario: "BASE" }, orderBy: { issuedAt: "desc" } }),
      db.forecast.findFirst({ where: { plantId: id, forHorizon: "WEEK", scenario: "OPTIMISTIC" }, orderBy: { issuedAt: "desc" } }),
      db.forecast.findFirst({ where: { plantId: id, forHorizon: "WEEK", scenario: "PESSIMISTIC" }, orderBy: { issuedAt: "desc" } }),
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
  const intradayBasePoints = parse(intradayBase?.points);
  const weekBasePoints = parse(weekBase?.points);
  const weekOptimisticPoints = parse(weekOptimistic?.points);
  const weekPessimisticPoints = parse(weekPessimistic?.points);

  // Recompute attribution deterministically from the same inputs the seed used.
  const fullHistory = await db.generation.findMany({ where: { plantId: id }, orderBy: { timestamp: "asc" } });
  const fullWeather = await db.weatherReading.findMany({ where: { plantId: id }, orderBy: { timestamp: "asc" } });
  const recomputed = generateForecast({
    plantId: id,
    plantType: plant.type as PlantType,
    capacityMW: plant.capacityMW,
    history: fullHistory.slice(-24 * 30),
    weatherHistory: fullWeather.slice(-24 * 30),
    weatherForecast: fullWeather.slice(-24),
    horizon: "DAY_AHEAD",
    scenario: "BASE",
  });
  const attribution: AttributionPoint[] = recomputed.attribution;

  const narration = await narrateForecast({
    plantId: id,
    plantName: plant.name,
    plantType: plant.type,
    capacityMW: plant.capacityMW,
    scenario: "BASE",
    points: basePoints,
    attribution,
    weather: weather.slice(-24).map((w) => ({ ...w, timestamp: new Date(w.timestamp) })),
  });
  const explanation = narration.text;
  const explanationSource = narration.source;

  const accuracy = await db.forecastAccuracy.findMany({
    where: { plantId: id },
    orderBy: { computedAt: "desc" },
    take: 30,
  });
  const alerts = await db.alert.findMany({ where: { plantId: id }, orderBy: { createdAt: "desc" }, take: 30 });

  // Baseline comparison on the trailing window
  let baselineComparison = null as null | ReturnType<typeof compareToBaselines>;
  if (basePoints.length > 0 && fullHistory.length >= basePoints.length) {
    const actualWindow = fullHistory.slice(-basePoints.length);
    const ourPredicted = basePoints.slice(0, actualWindow.length).map((p) => p.forecastMW);
    if (actualWindow.length >= 4) {
      baselineComparison = compareToBaselines({
        history: fullHistory,
        actual: actualWindow.map((row) => ({
          timestamp: new Date(row.timestamp),
          actualMW: row.actualMW,
          availableMW: row.availableMW,
          curtailedMW: row.curtailedMW,
        })),
        ourPredicted,
      });
    }
  }

  // Weather source tag (per-plant)
  const cached = readWeatherFile(plant.code);
  const weatherSource: "OPEN_METEO" | "FALLBACK_MOCK" | "MIXED" =
    cached?.source === "OPEN_METEO" && cached.rows.length > 0 ? "OPEN_METEO" : "FALLBACK_MOCK";

  return {
    plant,
    generation,
    weather,
    base,
    basePoints,
    optimisticPoints,
    pessimisticPoints,
    intradayBasePoints,
    weekBasePoints,
    weekOptimisticPoints,
    weekPessimisticPoints,
    attribution,
    explanation,
    explanationSource,
    accuracy,
    alerts,
    baselineComparison,
    weatherSource,
  };
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

  // curtailedMW × 1h × ₹3500/MWh (Karnataka KREDL PPA rate) → rupees → convert to lakh
  const curtailmentCostLakh = data.generation
    .slice(-24 * 14)
    .reduce((sum, row) => sum + (row.curtailedMW * 3500) / 100000, 0);

  const forecastChart = data.basePoints.map((point, idx) => ({
    time: point.timestamp.toISOString().slice(5, 16).replace("T", " "),
    Actual: data.generation[data.generation.length - data.basePoints.length + idx]?.actualMW ?? null,
    Base: point.forecastMW,
    Optimistic: data.optimisticPoints[idx]?.forecastMW ?? null,
    Pessimistic: data.pessimisticPoints[idx]?.forecastMW ?? null,
    Lower: point.lowerBoundMW,
    Upper: point.upperBoundMW,
  }));

  const intradayForecastChart = data.intradayBasePoints.map((point, idx) => ({
    time: point.timestamp.toISOString().slice(5, 16).replace("T", " "),
    Actual: data.generation[data.generation.length - data.intradayBasePoints.length + idx]?.actualMW ?? null,
    Base: point.forecastMW,
    Optimistic: null as number | null,
    Pessimistic: null as number | null,
    Lower: point.lowerBoundMW,
    Upper: point.upperBoundMW,
  }));

  const weekForecastChart = data.weekBasePoints.map((point, idx) => ({
    time: point.timestamp.toISOString().slice(5, 16).replace("T", " "),
    Actual: data.generation[data.generation.length - data.weekBasePoints.length + idx]?.actualMW ?? null,
    Base: point.forecastMW,
    Optimistic: data.weekOptimisticPoints[idx]?.forecastMW ?? null,
    Pessimistic: data.weekPessimisticPoints[idx]?.forecastMW ?? null,
    Lower: point.lowerBoundMW,
    Upper: point.upperBoundMW,
  }));

  const attributionCategories =
    data.plant.type === "WIND"
      ? ["Baseline", "Wind shortfall", "Scenario adj"]
      : ["Baseline", "Cloud penalty", "Temp derate", "Scenario adj"];

  const attributionChart = data.attribution.map((a) => {
    const time = a.timestamp.toISOString().slice(5, 16).replace("T", " ");
    if (data.plant.type === "WIND") {
      return {
        time,
        Baseline: Number(a.baselineMW.toFixed(2)),
        "Wind shortfall": Number(a.windFactorMW.toFixed(2)),
        "Scenario adj": Number(a.scenarioAdjustmentMW.toFixed(2)),
      };
    }
    return {
      time,
      Baseline: Number(a.baselineMW.toFixed(2)),
      "Cloud penalty": -Number(a.cloudPenaltyMW.toFixed(2)),
      "Temp derate": -Number(a.tempDeratingMW.toFixed(2)),
      "Scenario adj": Number(a.scenarioAdjustmentMW.toFixed(2)),
    };
  });

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
        plantName={data.plant.name}
        plantType={data.plant.type}
        baseMeanConfidence={data.base?.meanConfidence ?? 0}
        baseModelVersion={data.base?.modelVersion ?? "sv-0.3"}
        explanation={data.explanation}
        explanationSource={data.explanationSource}
        forecastChart={forecastChart}
        intradayForecastChart={intradayForecastChart}
        weekForecastChart={weekForecastChart}
        curtailmentCostLakh={curtailmentCostLakh}
        attributionChart={attributionChart}
        attributionCategories={attributionCategories}
        historyChart={historyChart}
        weatherChart={weatherChart}
        weatherSource={data.weatherSource}
        baselineComparison={data.baselineComparison}
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
