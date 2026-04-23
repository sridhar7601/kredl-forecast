import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  const plants = await db.plant.findMany();
  const totalCapacityMW = plants.reduce((sum, p) => sum + p.capacityMW, 0);
  const openAlerts = await db.alert.count({ where: { acknowledged: false } });
  return NextResponse.json({ totalPlants: plants.length, totalCapacityMW, openAlerts });
}
