import Link from "next/link";
import { Badge, Card, Select, SelectItem, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, Title } from "@tremor/react";
import { db } from "@/lib/db";

async function getPlants() {
  const plants = await db.plant.findMany({ orderBy: { name: "asc" } });
  const enriched = await Promise.all(
    plants.map(async (plant) => {
      const latest = await db.generation.findFirst({
        where: { plantId: plant.id },
        orderBy: { timestamp: "desc" },
      });
      const forecast = await db.forecast.findFirst({
        where: { plantId: plant.id, scenario: "BASE", forHorizon: "DAY_AHEAD" },
        orderBy: { issuedAt: "desc" },
      });
      const mape = await db.forecastAccuracy.findFirst({
        where: { plantId: plant.id },
        orderBy: { computedAt: "desc" },
      });
      const tomorrow = forecast ? Number((JSON.parse(forecast.points) as Array<{ forecastMW: number }>)[0]?.forecastMW ?? 0) : 0;
      return { plant, latestMW: latest?.actualMW ?? 0, tomorrow, mape: mape?.mape ?? null };
    }),
  );
  return enriched;
}

export default async function PlantsPage() {
  const rows = await getPlants();

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <Title>Plants</Title>
          <p className="text-sm text-slate-600">Filter and monitor all solar and wind assets.</p>
        </div>
        <div className="flex gap-2">
          <Select defaultValue="ALL" className="w-40">
            <SelectItem value="ALL">All types</SelectItem>
            <SelectItem value="SOLAR_PV">Solar</SelectItem>
            <SelectItem value="WIND">Wind</SelectItem>
          </Select>
          <Select defaultValue="ALL" className="w-40">
            <SelectItem value="ALL">All statuses</SelectItem>
            <SelectItem value="ACTIVE">Active</SelectItem>
            <SelectItem value="MAINTENANCE">Maintenance</SelectItem>
            <SelectItem value="CURTAILED">Curtailed</SelectItem>
            <SelectItem value="OFFLINE">Offline</SelectItem>
          </Select>
        </div>
      </div>

      <Card>
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Plant</TableHeaderCell>
              <TableHeaderCell>Type</TableHeaderCell>
              <TableHeaderCell>District</TableHeaderCell>
              <TableHeaderCell>Capacity MW</TableHeaderCell>
              <TableHeaderCell>Current MW</TableHeaderCell>
              <TableHeaderCell>Tomorrow MW</TableHeaderCell>
              <TableHeaderCell>MAPE</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.plant.id}>
                <TableCell>
                  <Link href={`/plants/${row.plant.id}`} className="font-medium text-orange-700 hover:text-orange-800">
                    {row.plant.code} · {row.plant.name}
                  </Link>
                </TableCell>
                <TableCell>{row.plant.type === "SOLAR_PV" ? "Solar" : "Wind"}</TableCell>
                <TableCell>{row.plant.district}</TableCell>
                <TableCell>{row.plant.capacityMW.toFixed(1)}</TableCell>
                <TableCell>{row.latestMW.toFixed(1)}</TableCell>
                <TableCell>{row.tomorrow.toFixed(1)}</TableCell>
                <TableCell>{row.mape === null ? "NA" : `${row.mape.toFixed(2)}%`}</TableCell>
                <TableCell>
                  <Badge color={row.plant.status === "OFFLINE" ? "red" : row.plant.status === "MAINTENANCE" ? "orange" : "emerald"}>
                    {row.plant.status}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
