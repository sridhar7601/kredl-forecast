import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  const items = await db.modelVersion.findMany({ orderBy: { trainedAt: "desc" } });
  return NextResponse.json({ total: items.length, items });
}
