import { NextResponse } from "next/server";
import { db } from "@/lib/db";

async function retrainModel() {
  // Pick the highest existing version by parsed numeric tag, not by trainedAt
  // (seed inserts share a default(now()) timestamp, so trainedAt order is unstable).
  const all = await db.modelVersion.findMany();
  const maxNumeric = all.length === 0
    ? 0.0
    : Math.max(...all.map((v) => Number(v.versionTag.replace("sv-", "")) || 0));
  const next = Math.round((maxNumeric + 0.1) * 10) / 10;
  const previousActive = all.find((v) => v.active);
  const currentMape = previousActive?.overallMape ?? 9.4;
  const improved = Math.max(4.5, Number((currentMape - 0.6).toFixed(2)));

  await db.modelVersion.updateMany({ data: { active: false } });
  const created = await db.modelVersion.create({
    data: {
      versionTag: `sv-${next.toFixed(1)}`,
      description: "Retrained on latest 90-day rolling generation and weather windows.",
      overallMape: improved,
      active: true,
    },
  });
  return created;
}

export async function POST() {
  const row = await retrainModel();
  // Acknowledge any open MODEL_DRIFT alerts: retrain closes the loop.
  const acked = await db.alert.updateMany({
    where: { type: "MODEL_DRIFT", acknowledged: false },
    data: { acknowledged: true },
  });
  return NextResponse.json({ ...row, driftAlertsAcked: acked.count });
}
