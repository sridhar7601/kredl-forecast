import Link from "next/link";
import { Badge, Card, LineChart, Title } from "@tremor/react";
import { aggregateClusterAccuracy, aggregateClusterForecast, getCluster } from "@/lib/cluster";
import { db } from "@/lib/db";

export default async function ClusterDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cluster = await getCluster(id);
  if (!cluster) {
    return (
      <Card>
        <p className="text-tremor-content">Cluster not found.</p>
      </Card>
    );
  }

  const [base, optimistic, pessimistic, accuracy, plants] = await Promise.all([
    aggregateClusterForecast(id, "DAY_AHEAD", "BASE"),
    aggregateClusterForecast(id, "DAY_AHEAD", "OPTIMISTIC"),
    aggregateClusterForecast(id, "DAY_AHEAD", "PESSIMISTIC"),
    aggregateClusterAccuracy(id),
    db.plant.findMany({ where: { id: { in: cluster.plantIds } }, orderBy: { name: "asc" } }),
  ]);

  const chart = (base?.points ?? []).map((p, idx) => ({
    time: p.timestamp.toISOString().slice(5, 16).replace("T", " "),
    Base: p.forecastMW,
    Optimistic: optimistic?.points[idx]?.forecastMW ?? null,
    Pessimistic: pessimistic?.points[idx]?.forecastMW ?? null,
    Lower: p.lowerBoundMW,
    Upper: p.upperBoundMW,
  }));

  return (
    <div className="space-y-6">
      <Link href="/clusters" className="text-sm font-medium text-orange-700 hover:text-orange-800">
        ← Back to clusters
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Title>{cluster.id}</Title>
          <p className="text-sm text-tremor-content">
            {cluster.district} · {cluster.type === "SOLAR_PV" ? "Solar" : "Wind"} · {cluster.plantCount} plants ·{" "}
            {cluster.totalCapacityMW.toFixed(1)} MW total
          </p>
        </div>
        <Badge color={cluster.type === "WIND" ? "sky" : "amber"}>{cluster.type === "SOLAR_PV" ? "Solar" : "Wind"}</Badge>
      </div>

      <Card>
        <Title>Aggregate day-ahead forecast (sum of plant forecasts, sum-of-variances bounds)</Title>
        <div className="mt-4 h-80 w-full min-h-[20rem]">
          <LineChart
            className="h-80"
            data={chart}
            index="time"
            categories={["Base", "Optimistic", "Pessimistic", "Lower", "Upper"]}
            colors={["orange", "amber", "yellow", "gray", "gray"]}
            yAxisWidth={48}
          />
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <p className="text-sm text-tremor-content">Mean confidence</p>
          <p className="text-2xl font-semibold text-tremor-content-strong">
            {((base?.meanConfidence ?? 0) * 100).toFixed(0)}%
          </p>
        </Card>
        <Card>
          <p className="text-sm text-tremor-content">Capacity-weighted MAPE</p>
          <p className="text-2xl font-semibold text-tremor-content-strong">
            {accuracy ? `${accuracy.weightedMape.toFixed(2)}%` : "NA"}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-tremor-content">Plants in cluster</p>
          <p className="text-2xl font-semibold text-tremor-content-strong">{cluster.plantCount}</p>
        </Card>
      </div>

      <Card>
        <Title>Member plants</Title>
        <ul className="mt-3 space-y-2 text-sm">
          {plants.map((p) => (
            <li key={p.id}>
              <Link href={`/plants/${p.id}`} className="font-medium text-orange-700 hover:text-orange-800">
                {p.code} · {p.name}
              </Link>
              <span className="text-slate-600"> — {p.capacityMW.toFixed(1)} MW · {p.status}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
