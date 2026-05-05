"use client";

import { useState } from "react";
import {
  AreaChart,
  Badge,
  BarChart,
  Button,
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

export type ChartRow = Record<string, string | number | null | undefined>;

export type PlantDetailTabsProps = {
  plantName: string;
  plantType: string;
  curtailmentCostLakh: number;
  intradayForecastChart: ChartRow[];
  weekForecastChart: ChartRow[];
  baseMeanConfidence: number;
  baseModelVersion: string;
  explanation: string;
  explanationSource: "AZURE_OPENAI" | "OPENAI" | "DETERMINISTIC_FALLBACK";
  forecastChart: ChartRow[];
  attributionChart: ChartRow[];
  attributionCategories: string[];
  historyChart: ChartRow[];
  weatherChart: ChartRow[];
  weatherSource: "OPEN_METEO" | "FALLBACK_MOCK" | "MIXED";
  baselineComparison: {
    ourMape: number;
    persistenceMape: number;
    seasonalNaiveMape: number;
    improvementVsPersistencePct: number;
    improvementVsSeasonalNaivePct: number;
    sampleSize: number;
  } | null;
  mape7: number;
  mape30: number;
  rmse30: number;
  mbe30: number;
  accuracy: Array<{
    id: string;
    computedAt: string;
    mape: number;
    rmse: number;
    mbe: number;
    sampleSize: number;
  }>;
  alerts: Array<{
    id: string;
    title: string;
    description: string;
    type: string;
    severity: string;
    acknowledged: boolean;
    createdAt: string;
  }>;
};

function dataSourceLabel(source: PlantDetailTabsProps["weatherSource"]): string {
  if (source === "OPEN_METEO") return "Weather: Open-Meteo (real). Generation: synthetic, weather-driven.";
  if (source === "MIXED") return "Weather: mixed (Open-Meteo where available, synthetic fallback otherwise).";
  return "Weather + Generation: synthetic (Open-Meteo unreachable at fetch time).";
}

export function PlantDetailTabs({
  plantName,
  plantType,
  curtailmentCostLakh,
  intradayForecastChart,
  weekForecastChart,
  baseMeanConfidence,
  baseModelVersion,
  explanation,
  explanationSource,
  forecastChart,
  attributionChart,
  attributionCategories,
  historyChart,
  weatherChart,
  weatherSource,
  baselineComparison,
  mape7,
  mape30,
  rmse30,
  mbe30,
  accuracy,
  alerts,
}: PlantDetailTabsProps) {
  const weatherCategories = plantType === "SOLAR_PV" ? ["GHI", "Cloud", "Temp"] : ["Wind", "Cloud", "Temp"];
  const dailyHistory = historyChart.filter((_, idx) => idx % 24 === 0);

  const baselineBars = baselineComparison
    ? [
        { method: "SuryaVayu (ours)", MAPE: baselineComparison.ourMape },
        { method: "Persistence (t−24h)", MAPE: baselineComparison.persistenceMape },
        { method: "Seasonal-naive (t−168h)", MAPE: baselineComparison.seasonalNaiveMape },
      ]
    : [];

  type HorizonKey = "6H" | "DAY_AHEAD" | "WEEK";
  const [selectedHorizon, setSelectedHorizon] = useState<HorizonKey>("DAY_AHEAD");

  const activeChart =
    selectedHorizon === "6H" ? intradayForecastChart
    : selectedHorizon === "WEEK" ? weekForecastChart
    : forecastChart;

  const showAttribution = selectedHorizon === "DAY_AHEAD";

  function handleDownloadCsv() {
    const header = "time,actual_mw,base_mw,optimistic_mw,pessimistic_mw,lower_bound_mw,upper_bound_mw";
    const rows = activeChart.map((row) =>
      [
        row["time"] ?? "",
        row["Actual"] ?? "",
        row["Base"] ?? "",
        row["Optimistic"] ?? "",
        row["Pessimistic"] ?? "",
        row["Lower"] ?? "",
        row["Upper"] ?? "",
      ].join(","),
    );
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${plantName.replace(/[^a-zA-Z0-9]/g, "_")}_${selectedHorizon}_forecast.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-2">
                {(["6H", "DAY_AHEAD", "WEEK"] as HorizonKey[]).map((h) => (
                  <Button
                    key={h}
                    size="xs"
                    variant={selectedHorizon === h ? "primary" : "secondary"}
                    onClick={() => setSelectedHorizon(h)}
                  >
                    {h === "6H" ? "6H" : h === "DAY_AHEAD" ? "Day-Ahead" : "Week"}
                  </Button>
                ))}
              </div>
              <Button size="xs" variant="secondary" onClick={handleDownloadCsv}>
                Download CSV
              </Button>
            </div>

            <Card>
              <Title>Forecast scenarios with confidence band</Title>
              <div className="mt-4 h-80 w-full min-h-[20rem] overflow-x-auto">
                <LineChart
                  className="h-80"
                  data={activeChart}
                  index="time"
                  categories={["Actual", "Base", "Optimistic", "Pessimistic", "Lower", "Upper"]}
                  colors={["slate", "orange", "amber", "yellow", "gray", "gray"]}
                  yAxisWidth={48}
                />
              </div>
            </Card>

            {showAttribution && (
              <Card>
                <Title>Why this forecast? (per-hour attribution)</Title>
                <p className="mt-1 text-sm text-tremor-content">
                  Stacked decomposition: each bar is a forecast hour, broken into the same intermediate terms the engine produces.
                  Negative segments subtract from the diurnal/rated baseline.
                </p>
                <div className="mt-4 h-80 w-full min-h-[20rem] overflow-x-auto">
                  <BarChart
                    className="h-80"
                    data={attributionChart}
                    index="time"
                    categories={attributionCategories}
                    colors={["amber", "slate", "rose", "sky", "yellow"]}
                    stack
                    yAxisWidth={48}
                  />
                </div>
              </Card>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <p className="text-sm text-tremor-content">Mean confidence</p>
                <p className="text-2xl font-semibold text-tremor-content-strong">{(baseMeanConfidence * 100).toFixed(0)}%</p>
                <p className="text-xs text-tremor-content">Model: {baseModelVersion} · feature-conditioned (asset type as input feature, not model selector)</p>
              </Card>
              <Card decoration="left" decorationColor="indigo">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-tremor-content-strong">AI Grid Analysis</p>
                  <Badge color={explanationSource === "AZURE_OPENAI" ? "indigo" : explanationSource === "OPENAI" ? "emerald" : "slate"}>
                    {explanationSource === "AZURE_OPENAI" ? "Azure GPT-4.1" : explanationSource === "OPENAI" ? "OpenAI" : "Deterministic"}
                  </Badge>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-tremor-content-strong whitespace-pre-line">{explanation}</p>
                <p className="mt-2 text-xs text-tremor-content">Grounded in the attribution numbers above — AI only describes what the physics model computed, no hallucinated values.</p>
              </Card>
            </div>
          </div>
        </TabPanel>

        <TabPanel>
          <div className="space-y-4 pt-4">
            <Card>
              <Title>Generation and curtailment history</Title>
              <div className="mt-4 h-80 w-full min-h-[20rem]">
                <AreaChart
                  className="h-80"
                  data={historyChart}
                  index="time"
                  categories={["Actual", "Curtailment"]}
                  colors={["orange", "red"]}
                  yAxisWidth={48}
                />
              </div>
            </Card>
            <Card>
              <Title>Daily energy trend</Title>
              <div className="mt-4 h-72 w-full min-h-[18rem]">
                <BarChart className="h-72" data={dailyHistory} index="time" categories={["Actual"]} colors={["amber"]} yAxisWidth={48} />
              </div>
            </Card>
            <Card>
              <p className="text-sm text-tremor-content">Estimated curtailment revenue lost (14-day window)</p>
              <p className="text-2xl font-semibold text-tremor-content-strong">₹{curtailmentCostLakh.toFixed(2)} L</p>
              <p className="text-xs text-tremor-content">
                At Karnataka KREDL PPA rate ₹3.50/kWh · formula: Σ(curtailed MW × 1h × ₹3,500) ÷ 1,00,000
              </p>
            </Card>
          </div>
        </TabPanel>

        <TabPanel>
          <div className="space-y-4 pt-4">
            <Card>
              <Title>Weather drivers</Title>
              <p className="mt-1 text-xs text-tremor-content">{dataSourceLabel(weatherSource)}</p>
              <div className="mt-4 h-80 w-full min-h-[20rem]">
                <LineChart
                  className="h-80"
                  data={weatherChart}
                  index="time"
                  categories={weatherCategories}
                  colors={["amber", "slate", "orange"]}
                  yAxisWidth={48}
                />
              </div>
            </Card>
            <Card>
              <p className="text-sm text-tremor-content">
                Correlation note: output dips when cloud cover exceeds 70% or wind speed stays below cut-in threshold.
              </p>
            </Card>
          </div>
        </TabPanel>

        <TabPanel>
          <div className="space-y-4 pt-4">
            <div className="grid gap-4 md:grid-cols-3">
              <Card>
                <p className="text-sm text-tremor-content">MAPE (7d)</p>
                <p className="text-2xl font-semibold text-tremor-content-strong">{mape7.toFixed(2)}%</p>
              </Card>
              <Card>
                <p className="text-sm text-tremor-content">RMSE (30 records)</p>
                <p className="text-2xl font-semibold text-tremor-content-strong">{rmse30.toFixed(2)}</p>
              </Card>
              <Card>
                <p className="text-sm text-tremor-content">MBE (30 records)</p>
                <p className="text-2xl font-semibold text-tremor-content-strong">{mbe30.toFixed(2)}</p>
              </Card>
            </div>

            {baselineComparison ? (
              <Card>
                <Title>Baseline comparison (DAY_AHEAD back-test)</Title>
                <p className="mt-1 text-sm text-tremor-content">
                  SuryaVayu vs persistence (t−24h) and seasonal-naive (t−168h). Lower MAPE is better.
                </p>
                <div className="mt-4 h-64 w-full min-h-[16rem]">
                  <BarChart
                    className="h-64"
                    data={baselineBars}
                    index="method"
                    categories={["MAPE"]}
                    colors={["orange"]}
                    yAxisWidth={48}
                  />
                </div>
                <div className="mt-3 flex flex-wrap gap-3 text-sm">
                  <Badge color="emerald">
                    {baselineComparison.improvementVsPersistencePct.toFixed(1)}% better than persistence
                  </Badge>
                  <Badge color="emerald">
                    {baselineComparison.improvementVsSeasonalNaivePct.toFixed(1)}% better than seasonal-naive
                  </Badge>
                  <span className="text-xs text-tremor-content">n={baselineComparison.sampleSize}</span>
                </div>
              </Card>
            ) : null}

            <Card>
              <Title>Daily MAPE trend</Title>
              <div className="mt-4 h-72 w-full min-h-[18rem]">
                <BarChart
                  className="h-72"
                  data={accuracy.map((a) => ({
                    day: a.computedAt.slice(5, 10),
                    MAPE: a.mape,
                  }))}
                  index="day"
                  categories={["MAPE"]}
                  colors={["orange"]}
                  yAxisWidth={48}
                />
              </div>
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
                  {accuracy.map((a) => (
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
              <p className="text-xs text-tremor-content">30-day MAPE average: {mape30.toFixed(2)}%</p>
            </Card>
          </div>
        </TabPanel>

        <TabPanel>
          <div className="space-y-3 pt-4">
            {alerts.map((alert) => (
              <Card key={alert.id}>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-semibold text-tremor-content-strong">{alert.title}</p>
                    <p className="text-sm text-tremor-content">{alert.description}</p>
                    <p className="text-xs text-tremor-content">
                      {alert.type} · {new Date(alert.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <Badge color={alert.acknowledged ? "green" : alert.type === "MODEL_DRIFT" ? "purple" : "red"}>
                    {alert.acknowledged ? "ACKED" : alert.severity}
                  </Badge>
                </div>
              </Card>
            ))}
          </div>
        </TabPanel>
      </TabPanels>
    </TabGroup>
  );
}
