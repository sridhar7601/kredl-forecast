import Link from "next/link";
import {
  AreaChart,
  Badge,
  BarChart,
  Card,
  LineChart,
  Tab,
  TabGroup,
  TabList,
  TabPanel,
  TabPanels,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Title,
} from "@tremor/react";
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
    return <Card><p>Plant not found.</p></Card>;
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
      <Link href="/plants" className="text-sm font-medium text-orange-700">
        ← Back to plants
      </Link>
      <div className="flex items-center justify-between">
        <div>
          <Title>{data.plant.name}</Title>
          <p className="text-sm text-slate-600">
            {data.plant.code} · {data.plant.type} · {data.plant.capacityMW.toFixed(1)} MW · {data.plant.district}
          </p>
        </div>
        <Badge color={data.plant.status === "OFFLINE" ? "red" : data.plant.status === "MAINTENANCE" ? "orange" : "emerald"}>
          {data.plant.status}
        </Badge>
      </div>

      <TabGroup>
        <TabList variant="solid">
          <Tab>Forecast</Tab>
          <Tab>History</Tab>
          <Tab>Weather</Tab>
          <Tab>Accuracy</Tab>
          <Tab>Alerts</Tab>
        </TabList>
        <TabPanels>
          <TabPanel>
            <div className="space-y-4 pt-4">
              <Card>
                <Title>Forecast scenarios with confidence band</Title>
                <LineChart
                  className="mt-4 h-80"
                  data={forecastChart}
                  index="time"
                  categories={["Actual", "Base", "Optimistic", "Pessimistic", "Lower", "Upper"]}
                  colors={["slate", "orange", "amber", "yellow", "gray", "gray"]}
                />
              </Card>
              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <p className="text-sm text-slate-500">Mean confidence</p>
                  <p className="text-2xl font-semibold">{((data.base?.meanConfidence ?? 0) * 100).toFixed(0)}%</p>
                  <p className="text-xs text-slate-500">Model: {data.base?.modelVersion ?? "sv-0.2"}</p>
                </Card>
                <Card>
                  <p className="text-sm text-slate-500">Variance explanation (mock AI)</p>
                  <p className="mt-1 text-sm">{data.explanation}</p>
                </Card>
              </div>
            </div>
          </TabPanel>

          <TabPanel>
            <div className="space-y-4 pt-4">
              <Card>
                <Title>Generation and curtailment history</Title>
                <AreaChart className="mt-4 h-80" data={historyChart} index="time" categories={["Actual", "Curtailment"]} colors={["orange", "red"]} />
              </Card>
              <Card>
                <Title>Daily energy trend</Title>
                <BarChart
                  className="mt-4 h-72"
                  data={historyChart.filter((_, idx) => idx % 24 === 0)}
                  index="time"
                  categories={["Actual"]}
                  colors={["amber"]}
                />
              </Card>
            </div>
          </TabPanel>

          <TabPanel>
            <div className="space-y-4 pt-4">
              <Card>
                <Title>Weather drivers</Title>
                <LineChart
                  className="mt-4 h-80"
                  data={weatherChart}
                  index="time"
                  categories={data.plant.type === "SOLAR_PV" ? ["GHI", "Cloud", "Temp"] : ["Wind", "Cloud", "Temp"]}
                  colors={["amber", "slate", "orange"]}
                />
              </Card>
              <Card>
                <p className="text-sm">
                  Correlation note: output dips when cloud cover exceeds 70% or wind speed stays below cut-in threshold.
                </p>
              </Card>
            </div>
          </TabPanel>

          <TabPanel>
            <div className="space-y-4 pt-4">
              <div className="grid gap-4 md:grid-cols-3">
                <Card>
                  <p className="text-sm text-slate-500">MAPE (7d)</p>
                  <p className="text-2xl font-semibold">{mape7.toFixed(2)}%</p>
                </Card>
                <Card>
                  <p className="text-sm text-slate-500">RMSE (30 records)</p>
                  <p className="text-2xl font-semibold">{rmse30.toFixed(2)}</p>
                </Card>
                <Card>
                  <p className="text-sm text-slate-500">MBE (30 records)</p>
                  <p className="text-2xl font-semibold">{mbe30.toFixed(2)}</p>
                </Card>
              </div>
              <Card>
                <Title>Daily MAPE trend</Title>
                <BarChart
                  className="mt-4 h-72"
                  data={data.accuracy.map((a) => ({
                    day: new Date(a.computedAt).toISOString().slice(5, 10),
                    MAPE: a.mape,
                  }))}
                  index="day"
                  categories={["MAPE"]}
                  colors={["orange"]}
                />
              </Card>
              <Card>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableHeaderCell>Computed</TableHeaderCell>
                      <TableHeaderCell>MAPE</TableHeaderCell>
                      <TableHeaderCell>RMSE</TableHeaderCell>
                      <TableHeaderCell>MBE</TableHeaderCell>
                      <TableHeaderCell>Sample</TableHeaderCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.accuracy.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell>{new Date(a.computedAt).toLocaleString()}</TableCell>
                        <TableCell>{a.mape.toFixed(2)}%</TableCell>
                        <TableCell>{a.rmse.toFixed(2)}</TableCell>
                        <TableCell>{a.mbe.toFixed(2)}</TableCell>
                        <TableCell>{a.sampleSize}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
              <Card>
                <p className="text-xs text-slate-500">30-day MAPE average: {mape30.toFixed(2)}%</p>
              </Card>
            </div>
          </TabPanel>

          <TabPanel>
            <div className="space-y-3 pt-4">
              {data.alerts.map((alert) => (
                <Card key={alert.id}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold">{alert.title}</p>
                      <p className="text-sm text-slate-600">{alert.description}</p>
                      <p className="text-xs text-slate-500">
                        {alert.type} · {new Date(alert.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <Badge color={alert.acknowledged ? "green" : "red"}>{alert.acknowledged ? "ACKED" : alert.severity}</Badge>
                  </div>
                </Card>
              ))}
            </div>
          </TabPanel>
        </TabPanels>
      </TabGroup>
    </div>
  );
}
