import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const plant = await db.plant.findUnique({
    where: { id },
    include: {
      readings: { orderBy: { timestamp: "asc" }, take: 24 * 30 },
      weather: { orderBy: { timestamp: "asc" }, take: 24 * 30 },
      forecasts: { orderBy: { issuedAt: "desc" }, take: 9 },
      alerts: { orderBy: { createdAt: "desc" }, take: 20 },
      accuracy: { orderBy: { computedAt: "desc" }, take: 30 },
    },
  });

  if (!plant) {
    return NextResponse.json({ error: "Plant not found" }, { status: 404 });
  }

  return NextResponse.json(plant);
}
