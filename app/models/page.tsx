import { Badge, Card, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, Title } from "@tremor/react";
import { db } from "@/lib/db";
import { generateRetrainReport } from "@/lib/llm-narration";

async function getModels() {
  return db.modelVersion.findMany({ orderBy: { trainedAt: "desc" } });
}

export default async function ModelsPage() {
  const models = await getModels();
  const active = models.find((m) => m.active);
  const previous = models.filter((m) => !m.active)[0] ?? null;

  const retrainReport = active
    ? await generateRetrainReport({
        newVersion: active.versionTag,
        newMape: active.overallMape,
        previousVersion: previous?.versionTag ?? null,
        previousMape: previous?.overallMape ?? null,
        trainedOnDays: 90,
      })
    : null;

  return (
    <div className="space-y-6">
      <Title>Model History</Title>

      <Card>
        <p className="text-sm text-slate-500">Active model</p>
        {active ? (
          <>
            <div className="mt-2 flex items-center justify-between">
              <div>
                <p className="text-xl font-semibold">{active.versionTag}</p>
                <p className="text-sm text-slate-600">{active.description}</p>
              </div>
              <div className="text-right">
                <p className="text-sm text-slate-500">Overall MAPE</p>
                <p className="text-xl font-semibold">{active.overallMape.toFixed(2)}%</p>
              </div>
            </div>
            {retrainReport && (
              <div className="mt-4 rounded-md bg-indigo-50 border border-indigo-100 px-3 py-2">
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-xs font-semibold text-indigo-600">AI Model Analysis</p>
                  <Badge color="indigo">Azure GPT-4.1</Badge>
                </div>
                <p className="text-sm leading-relaxed text-tremor-content-strong whitespace-pre-line">{retrainReport}</p>
              </div>
            )}
          </>
        ) : (
          <p>No active model available.</p>
        )}
        <form action="/api/models/retrain" method="POST" className="mt-4">
          <button type="submit" className="rounded bg-orange-600 px-3 py-2 text-sm font-semibold text-white hover:bg-orange-700">
            Retrain on latest data
          </button>
        </form>
      </Card>

      <Card>
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Version</TableHeaderCell>
              <TableHeaderCell>Description</TableHeaderCell>
              <TableHeaderCell>MAPE</TableHeaderCell>
              <TableHeaderCell>Trained At</TableHeaderCell>
              <TableHeaderCell>State</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {models.map((model) => (
              <TableRow key={model.id}>
                <TableCell>{model.versionTag}</TableCell>
                <TableCell>{model.description}</TableCell>
                <TableCell>{model.overallMape.toFixed(2)}%</TableCell>
                <TableCell>{new Date(model.trainedAt).toLocaleString()}</TableCell>
                <TableCell>
                  <Badge color={model.active ? "green" : "gray"}>{model.active ? "ACTIVE" : "ARCHIVED"}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
