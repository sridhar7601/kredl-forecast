import { Badge, Card, Title } from "@tremor/react";
import { db } from "@/lib/db";
import { explainAlert } from "@/lib/llm-narration";

async function getAlerts() {
  return db.alert.findMany({
    orderBy: { createdAt: "desc" },
    include: { plant: true },
  });
}

export default async function AlertsPage() {
  const alerts = await getAlerts();

  // Generate AI explanations for top 5 unacknowledged HIGH/CRITICAL alerts only
  const priorityAlerts = alerts.filter((a) => !a.acknowledged && (a.severity === "CRITICAL" || a.severity === "HIGH")).slice(0, 5);
  const explanations = await Promise.all(
    priorityAlerts.map((a) =>
      explainAlert({
        alertId: a.id,
        type: a.type,
        severity: a.severity,
        title: a.title,
        description: a.description,
        plantName: a.plant?.name ?? null,
        plantType: a.plant?.type ?? null,
      }),
    ),
  );
  const explanationMap = new Map(priorityAlerts.map((a, i) => [a.id, explanations[i]]));

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <Title>Grid Alerts</Title>
          <p className="text-sm text-slate-600">Ramp, curtailment, deviation, and plant status signals.</p>
        </div>
        <Badge color="indigo">AI explanations: Azure GPT-4.1</Badge>
      </div>

      <div className="space-y-3">
        {alerts.map((alert) => {
          const aiExplanation = explanationMap.get(alert.id);
          return (
            <Card key={alert.id}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <Badge
                      color={
                        alert.severity === "CRITICAL" ? "red"
                        : alert.severity === "HIGH" ? "orange"
                        : alert.type === "MODEL_DRIFT" ? "purple"
                        : "amber"
                      }
                    >
                      {alert.severity}
                    </Badge>
                    <span className="text-xs font-mono text-slate-500">{alert.type}</span>
                    <span className="text-xs text-slate-400">{new Date(alert.createdAt).toLocaleString()}</span>
                  </div>
                  <p className="font-semibold text-tremor-content-strong">{alert.title}</p>
                  <p className="text-xs text-slate-500 mb-2">{alert.plant?.name ?? "Network-wide"}</p>
                  {aiExplanation ? (
                    <div className="rounded-md bg-indigo-50 border border-indigo-100 px-3 py-2">
                      <p className="text-xs font-semibold text-indigo-600 mb-1">AI Analysis (Azure GPT-4.1)</p>
                      <p className="text-sm text-tremor-content-strong">{aiExplanation}</p>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">{alert.description}</p>
                  )}
                </div>
                <div className="shrink-0">
                  {alert.acknowledged ? (
                    <Badge color="green">ACKED</Badge>
                  ) : (
                    <form action={`/api/alerts/${alert.id}/ack`} method="POST">
                      <button type="submit" className="rounded bg-orange-600 px-2 py-1 text-xs font-semibold text-white hover:bg-orange-700">
                        Ack
                      </button>
                    </form>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
