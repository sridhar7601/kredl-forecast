import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const where =
    from || to
      ? {
          plantId: id,
          timestamp: {
            gte: from ? new Date(from) : undefined,
            lte: to ? new Date(to) : undefined,
          },
        }
      : { plantId: id };

  const generation = await db.generation.findMany({ where, orderBy: { timestamp: "asc" } });
  const weather = await db.weatherReading.findMany({ where, orderBy: { timestamp: "asc" } });
  return NextResponse.json({ total: generation.length, generation, weather });
}
