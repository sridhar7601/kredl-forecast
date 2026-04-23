import Link from "next/link";
import { AreaChart, Badge, Card, Metric, Text, Title } from "@tremor/react";
import { db } from "@/lib/db";
import { parseForecastPoints } from "@/lib/data";
import { PlantMapPanel } from "@/components/plant-map-panel";
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

  return { plants, totalCapacity, currentOutput, tomorrowForecast, openAlerts, recentAlerts, timeline };
}

export default async function DashboardPage() {
  const data = await getDashboardData();

  return (
    <div className="space-y-6">
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
                  <Badge color={alert.severity === "CRITICAL" ? "red" : alert.severity === "HIGH" ? "orange" : "amber"}>
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
