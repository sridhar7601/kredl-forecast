import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const horizon = searchParams.get("horizon") ?? "DAY_AHEAD";
  const scenario = searchParams.get("scenario") ?? "BASE";

  const forecast = await db.forecast.findFirst({
    where: {
      plantId: id,
      forHorizon: horizon,
      scenario: scenario as "BASE" | "OPTIMISTIC" | "PESSIMISTIC",
    },
    orderBy: { issuedAt: "desc" },
  });

  if (!forecast) {
    return NextResponse.json({ error: "Forecast not found" }, { status: 404 });
  }

  return NextResponse.json(forecast);
}
