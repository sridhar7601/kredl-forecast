import Link from "next/link";
import { Card, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, Title, Badge } from "@tremor/react";
import { db } from "@/lib/db";
import { aggregateClusterAccuracy, aggregateClusterForecast, listClusters } from "@/lib/cluster";

async function getClusterRows() {
  const clusters = await listClusters();
  return Promise.all(
    clusters.map(async (cluster) => {
      const [generation, dayAhead, accuracy] = await Promise.all([
        db.generation.findMany({
          where: { plantId: { in: cluster.plantIds } },
          orderBy: { timestamp: "desc" },
          take: cluster.plantIds.length,
        }),
        aggregateClusterForecast(cluster.id, "DAY_AHEAD", "BASE"),
        aggregateClusterAccuracy(cluster.id),
      ]);

      const latestByPlant = new Map<string, number>();
      for (const row of generation) {
        if (!latestByPlant.has(row.plantId)) latestByPlant.set(row.plantId, row.actualMW);
      }
      const currentOutputMW = Array.from(latestByPlant.values()).reduce((s, v) => s + v, 0);
      const tomorrowMW = dayAhead?.points[0]?.forecastMW ?? 0;

      return {
        ...cluster,
        currentOutputMW,
        tomorrowForecastMW: tomorrowMW,
        weightedMape: accuracy?.weightedMape ?? null,
      };
    }),
  );
}

export default async function ClustersPage() {
  const rows = await getClusterRows();

  return (
    <div className="space-y-6">
      <div>
        <Title>Clusters</Title>
        <p className="text-sm text-slate-600">
          Plants grouped by district and asset type. KREDL/KSPDCL operate at this granularity for dispatch and curtailment planning.
        </p>
      </div>

      <Card>
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Cluster</TableHeaderCell>
              <TableHeaderCell>District</TableHeaderCell>
              <TableHeaderCell>Type</TableHeaderCell>
              <TableHeaderCell>Plants</TableHeaderCell>
              <TableHeaderCell>Capacity MW</TableHeaderCell>
              <TableHeaderCell>Current MW</TableHeaderCell>
              <TableHeaderCell>Tomorrow MW</TableHeaderCell>
              <TableHeaderCell>Weighted MAPE</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <Link href={`/clusters/${row.id}`} className="font-medium text-orange-700 hover:text-orange-800">
                    {row.id}
                  </Link>
                </TableCell>
                <TableCell>{row.district}</TableCell>
                <TableCell>
                  <Badge color={row.type === "WIND" ? "sky" : "amber"}>{row.type === "SOLAR_PV" ? "Solar" : "Wind"}</Badge>
                </TableCell>
                <TableCell>{row.plantCount}</TableCell>
                <TableCell>{row.totalCapacityMW.toFixed(1)}</TableCell>
                <TableCell>{row.currentOutputMW.toFixed(1)}</TableCell>
                <TableCell>{row.tomorrowForecastMW.toFixed(1)}</TableCell>
                <TableCell>{row.weightedMape === null ? "NA" : `${row.weightedMape.toFixed(2)}%`}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
