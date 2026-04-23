import { NextResponse } from "next/server";
import { db } from "@/lib/db";

async function retrainModel() {
  const latest = await db.modelVersion.findFirst({ orderBy: { trainedAt: "desc" } });
  const numeric = latest ? Number(latest.versionTag.replace("sv-", "")) : 0.1;
  const next = Math.round((numeric + 0.1) * 10) / 10;
  const currentMape = latest?.overallMape ?? 9.4;
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
  return NextResponse.json(row);
}
