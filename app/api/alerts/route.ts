import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const severity = searchParams.get("severity");
  const status = searchParams.get("status");

  const alerts = await db.alert.findMany({
    where: {
      severity: severity ? (severity as "CRITICAL" | "HIGH" | "MEDIUM" | "LOW") : undefined,
      acknowledged:
        status === "open" ? false : status === "acked" ? true : undefined,
    },
    orderBy: { createdAt: "desc" },
    include: { plant: true },
  });

  return NextResponse.json({ total: alerts.length, alerts });
}
