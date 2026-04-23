import { Badge, Card, Select, SelectItem, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, Title } from "@tremor/react";
import { db } from "@/lib/db";

async function getAlerts() {
  return db.alert.findMany({
    orderBy: { createdAt: "desc" },
    include: { plant: true },
  });
}

export default async function AlertsPage() {
  const alerts = await getAlerts();

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <Title>Grid Alerts</Title>
          <p className="text-sm text-slate-600">Ramp, curtailment, deviation, and plant status signals.</p>
        </div>
        <div className="flex gap-2">
          <Select className="w-40" defaultValue="ALL">
            <SelectItem value="ALL">All severities</SelectItem>
            <SelectItem value="CRITICAL">Critical</SelectItem>
            <SelectItem value="HIGH">High</SelectItem>
            <SelectItem value="MEDIUM">Medium</SelectItem>
            <SelectItem value="LOW">Low</SelectItem>
          </Select>
          <Select className="w-44" defaultValue="ALL">
            <SelectItem value="ALL">All types</SelectItem>
            <SelectItem value="RAMP_UP_STEEP">Ramp up</SelectItem>
            <SelectItem value="RAMP_DOWN_STEEP">Ramp down</SelectItem>
            <SelectItem value="CURTAILMENT_RISK">Curtailment</SelectItem>
            <SelectItem value="UNDER_FORECAST">Under forecast</SelectItem>
            <SelectItem value="OVER_FORECAST">Over forecast</SelectItem>
            <SelectItem value="PLANT_OFFLINE">Plant offline</SelectItem>
          </Select>
        </div>
      </div>

      <Card>
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Time</TableHeaderCell>
              <TableHeaderCell>Plant</TableHeaderCell>
              <TableHeaderCell>Type</TableHeaderCell>
              <TableHeaderCell>Severity</TableHeaderCell>
              <TableHeaderCell>Title</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {alerts.map((alert) => (
              <TableRow key={alert.id}>
                <TableCell>{new Date(alert.createdAt).toLocaleString()}</TableCell>
                <TableCell>{alert.plant?.name ?? "Network"}</TableCell>
                <TableCell>{alert.type}</TableCell>
                <TableCell>
                  <Badge color={alert.severity === "CRITICAL" ? "red" : alert.severity === "HIGH" ? "orange" : "amber"}>
                    {alert.severity}
                  </Badge>
                </TableCell>
                <TableCell>{alert.title}</TableCell>
                <TableCell>
                  {alert.acknowledged ? (
                    <Badge color="green">ACKED</Badge>
                  ) : (
                    <form action={`/api/alerts/${alert.id}/ack`} method="POST">
                      <button type="submit" className="rounded bg-orange-600 px-2 py-1 text-xs font-semibold text-white">
                        Ack
                      </button>
                    </form>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
