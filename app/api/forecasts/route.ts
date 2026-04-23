import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const plantId = searchParams.get("plantId");
  const horizon = searchParams.get("horizon");
  const scenario = searchParams.get("scenario");

  const items = await db.forecast.findMany({
    where: {
      plantId: plantId ?? undefined,
      forHorizon: horizon ?? undefined,
      scenario: scenario ? (scenario as "BASE" | "OPTIMISTIC" | "PESSIMISTIC") : undefined,
    },
    orderBy: { issuedAt: "desc" },
    take: 200,
  });

  return NextResponse.json({ total: items.length, items });
}
