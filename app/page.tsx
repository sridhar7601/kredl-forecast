import Link from "next/link";
import { AreaChart, Badge, Card, Metric, Text, Title } from "@tremor/react";
import { db } from "@/lib/db";
import { parseForecastPoints } from "@/lib/data";
import { listClusters } from "@/lib/cluster";
import { compareToBaselines } from "@/lib/baselines";
import { readWeatherFile } from "@/lib/weather-cache";
import { PlantMapPanel } from "@/components/plant-map-panel";
import { generateDailyBriefing } from "@/lib/llm-narration";
import type { PlantStatus } from "@/lib/types";

async function getDashboardData() {
  const plants = await db.plant.findMany({ orderBy: { name: "asc" } });

  const latestGeneration = await Promise.all(
    plants.map(async (plant) => {
      const latest = await db.generation.findFirst({
        where: { plantId: plant.id },
        orderBy: { timestamp: "desc" },
      });
      return { plantId: plant.id, mw: latest?.actualMW ?? 0 };
    }),
  );

  const baselineForecasts = await Promise.all(
    plants.map(async (plant) => {
      const f = await db.forecast.findFirst({
        where: { plantId: plant.id, scenario: "BASE", forHorizon: "DAY_AHEAD" },
        orderBy: { issuedAt: "desc" },
      });
      const first = f ? parseForecastPoints(f.points)[0] : null;
      return { plantId: plant.id, mw: first?.forecastMW ?? 0 };
    }),
  );

  const totalCapacity = plants.reduce((sum, p) => sum + p.capacityMW, 0);
  const currentOutput = latestGeneration.reduce((sum, row) => sum + row.mw, 0);
  const tomorrowForecast = baselineForecasts.reduce((sum, row) => sum + row.mw, 0);
  const openAlerts = await db.alert.count({ where: { acknowledged: false } });
  const recentAlerts = await db.alert.findMany({
    orderBy: { createdAt: "desc" },
    take: 8,
    include: { plant: true },
  });

  const weekStart = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const timelineRows = await db.generation.findMany({
    where: { timestamp: { gte: weekStart } },
    orderBy: { timestamp: "asc" },
    select: { timestamp: true, actualMW: true, availableMW: true },
  });

  const hourlyBuckets = new Map<string, { actual: number; forecast: number }>();
  for (const row of timelineRows) {
    const hourStamp = new Date(row.timestamp);
    hourStamp.setMinutes(0, 0, 0);
    const key = hourStamp.toISOString().slice(0, 16);
    const bucket = hourlyBuckets.get(key) ?? { actual: 0, forecast: 0 };
    bucket.actual += row.actualMW;
    bucket.forecast += row.availableMW;
    hourlyBuckets.set(key, bucket);
  }

  const timeline = Array.from(hourlyBuckets.entries()).map(([hour, value]) => ({
    hour: hour.slice(5, 16).replace("T", " "),
    Actual: Number(value.actual.toFixed(2)),
    Forecast: Number(value.forecast.toFixed(2)),
  }));

  // Top clusters
  const clusters = await listClusters();
  const topClusters = clusters.slice(0, 4);

  // Average baseline improvement across plants (DAY_AHEAD back-test)
  let meanImprovementVsPersistence = 0;
  let meanImprovementVsSeasonal = 0;
  let baselineSampleCount = 0;
  for (const plant of plants) {
    const f = await db.forecast.findFirst({
      where: { plantId: plant.id, scenario: "BASE", forHorizon: "DAY_AHEAD" },
      orderBy: { issuedAt: "desc" },
    });
    if (!f) continue;
    const points = parseForecastPoints(f.points);
    if (points.length === 0) continue;
    const history = await db.generation.findMany({
      where: { plantId: plant.id },
      orderBy: { timestamp: "asc" },
    });
    if (history.length < points.length) continue;
    const actualWindow = history.slice(-points.length);
    const ourPredicted = points.slice(0, actualWindow.length).map((p) => p.forecastMW);
    if (actualWindow.length < 4) continue;
    const cmp = compareToBaselines({
      history,
      actual: actualWindow.map((row) => ({
        timestamp: new Date(row.timestamp),
        actualMW: row.actualMW,
        availableMW: row.availableMW,
        curtailedMW: row.curtailedMW,
      })),
      ourPredicted,
    });
    meanImprovementVsPersistence += cmp.improvementVsPersistencePct;
    meanImprovementVsSeasonal += cmp.improvementVsSeasonalNaivePct;
    baselineSampleCount += 1;
  }
  if (baselineSampleCount > 0) {
    meanImprovementVsPersistence /= baselineSampleCount;
    meanImprovementVsSeasonal /= baselineSampleCount;
  }

  // Dispatch recommendation: find the next significant ramp event across all plant forecasts
  let dispatchRec: { plantName: string; action: string; atHour: string; deltaMW: number } | null = null;
  for (const plant of plants) {
    const f = await db.forecast.findFirst({
      where: { plantId: plant.id, scenario: "BASE", forHorizon: "DAY_AHEAD" },
      orderBy: { issuedAt: "desc" },
    });
    if (!f) continue;
    const pts = parseForecastPoints(f.points);
    for (let i = 1; i < pts.length; i++) {
      const delta = pts[i].forecastMW - pts[i - 1].forecastMW;
      if (Math.abs(delta) > (dispatchRec ? Math.abs(dispatchRec.deltaMW) : plant.capacityMW * 0.15)) {
        dispatchRec = {
          plantName: plant.name,
          action: delta > 0 ? `↑ ramp up` : `↓ ramp down`,
          atHour: pts[i].timestamp.toISOString().slice(11, 16),
          deltaMW: delta,
        };
      }
    }
  }

  // Weather data source rollup
  let realCount = 0;
  let fallbackCount = 0;
  for (const plant of plants) {
    const cached = readWeatherFile(plant.code);
    if (cached?.source === "OPEN_METEO" && cached.rows.length > 0) realCount += 1;
    else fallbackCount += 1;
  }
  const dataSourceLabel =
    realCount > 0 && fallbackCount === 0
      ? "Open-Meteo (real, all plants)"
      : realCount > 0
        ? `Open-Meteo (${realCount}/${plants.length} plants) + synthetic fallback`
        : "Synthetic only — run npm run fetch-weather";

  return {
    plants,
    totalCapacity,
    currentOutput,
    tomorrowForecast,
    openAlerts,
    recentAlerts,
    timeline,
    topClusters,
    meanImprovementVsPersistence,
    meanImprovementVsSeasonal,
    baselineSampleCount,
    dataSourceLabel,
    dispatchRec,
    dailyBriefing: await generateDailyBriefing({
      totalCapacityMW: totalCapacity,
      currentOutputMW: currentOutput,
      tomorrowForecastMW: tomorrowForecast,
      openAlerts,
      topClusters: clusters.slice(0, 3).map((c) => ({ id: c.id, totalCapacityMW: c.totalCapacityMW })),
      meanImprovementVsPersistence,
    }),
  };
}

export default async function DashboardPage() {
  const data = await getDashboardData();

  return (
    <div className="space-y-6">
      <Card decoration="left" decorationColor="indigo" className="border-l-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <p className="text-sm font-semibold text-indigo-700">AI Daily Briefing</p>
              <Badge color="indigo">Azure GPT-4.1</Badge>
            </div>
            <p className="text-sm leading-relaxed text-tremor-content-strong whitespace-pre-line">{data.dailyBriefing}</p>
          </div>
        </div>
      </Card>

      <div className="flex items-center justify-between">
        <p className="text-xs text-tremor-content">Weather data: {data.dataSourceLabel}</p>
        <Badge color="orange">SuryaVayu sv-0.3</Badge>
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        <Card decoration="top" decorationColor="orange">
          <Text>Total Capacity</Text>
          <Metric>{data.totalCapacity.toFixed(1)} MW</Metric>
        </Card>
        <Card decoration="top" decorationColor="amber">
          <Text>Current Output</Text>
          <Metric>{data.currentOutput.toFixed(1)} MW</Metric>
        </Card>
        <Card decoration="top" decorationColor="yellow">
          <Text>Tomorrow Forecast</Text>
          <Metric>{data.tomorrowForecast.toFixed(1)} MW</Metric>
        </Card>
        <Card decoration="top" decorationColor="red">
          <Text>Open Alerts</Text>
          <Metric>{data.openAlerts}</Metric>
        </Card>
      </div>

      {data.dispatchRec && (
        <Card decoration="left" decorationColor="sky" className="border-l-4 border-sky-500">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Text className="font-semibold text-sky-700">Next dispatch action</Text>
              <p className="mt-1 text-lg font-bold text-tremor-content-strong">
                {data.dispatchRec.action} {Math.abs(data.dispatchRec.deltaMW).toFixed(1)} MW at {data.dispatchRec.atHour}
              </p>
              <p className="text-sm text-tremor-content">{data.dispatchRec.plantName} · Based on DAY_AHEAD BASE scenario</p>
            </div>
            <Badge color="sky">GRID OPS</Badge>
          </div>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card decoration="left" decorationColor="emerald">
          <Text>Avg improvement vs baselines (DAY_AHEAD MAPE)</Text>
          {data.baselineSampleCount === 0 ? (
            <Metric>—</Metric>
          ) : (
            <>
              <Metric>
                {data.meanImprovementVsPersistence.toFixed(1)}% / {data.meanImprovementVsSeasonal.toFixed(1)}%
              </Metric>
              <Text>vs persistence (t−24h) and seasonal-naive (t−168h), n={data.baselineSampleCount} plants</Text>
            </>
          )}
        </Card>
        <Card decoration="left" decorationColor="orange">
          <Text>Top clusters by capacity</Text>
          <ul className="mt-3 space-y-2 text-sm">
            {data.topClusters.map((c) => (
              <li key={c.id}>
                <Link href={`/clusters/${c.id}`} className="font-medium text-orange-700 hover:text-orange-800">
                  {c.id}
                </Link>
                <span className="text-slate-600">
                  {" "}— {c.totalCapacityMW.toFixed(1)} MW · {c.plantCount} plants
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card>
        <Title>Network-wide actual vs forecast (last 7 days)</Title>
        <AreaChart className="mt-4 h-80" data={data.timeline} index="hour" categories={["Actual", "Forecast"]} colors={["orange", "amber"]} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <Title>Plant map</Title>
          <Text>Status colored markers across Karnataka.</Text>
          <div className="mt-4">
            <PlantMapPanel
              plants={data.plants.map((p) => ({
                id: p.id,
                name: p.name,
                lat: p.lat,
                lng: p.lng,
                status: p.status as PlantStatus,
                capacityMW: p.capacityMW,
                district: p.district,
              }))}
            />
          </div>
        </Card>

        <Card>
          <div className="mb-4 flex items-center justify-between">
            <Title>Recent alerts</Title>
            <Link href="/alerts" className="text-sm font-medium text-orange-700">
              View all
            </Link>
          </div>
          <div className="space-y-3">
            {data.recentAlerts.map((alert) => (
              <div key={alert.id} className="rounded-md border border-orange-100 p-3">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <Badge
                    color={
                      alert.severity === "CRITICAL"
                        ? "red"
                        : alert.severity === "HIGH"
                          ? "orange"
                          : alert.type === "MODEL_DRIFT"
                            ? "purple"
                            : "amber"
                    }
                  >
                    {alert.severity}
                  </Badge>
                  <Text>{new Date(alert.createdAt).toLocaleString()}</Text>
                </div>
                <p className="text-sm font-medium">{alert.title}</p>
                <p className="text-xs text-slate-600">{alert.plant?.name ?? "Network"} · {alert.type}</p>
              </div>
            ))}
          </div>
          <Link
            href="/api/forecasts/generate"
            className="mt-4 inline-block rounded-md bg-orange-600 px-3 py-2 text-sm font-semibold text-white hover:bg-orange-700"
          >
            Generate Forecasts
          </Link>
        </Card>
      </div>
    </div>
  );
}
