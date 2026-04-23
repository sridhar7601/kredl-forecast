import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  const plants = await db.plant.findMany();
  const totalCapacityMW = plants.reduce((sum, p) => sum + p.capacityMW, 0);
  const openAlerts = await db.alert.count({ where: { acknowledged: false } });
  const totalAlerts = await db.alert.count();
  const activeModels = await db.modelVersion.count({ where: { active: true } });

  const currentOutput = await Promise.all(
    plants.map((p) =>
      db.generation.findFirst({ where: { plantId: p.id }, orderBy: { timestamp: "desc" } }),
    ),
  );
  const currentOutputMW = currentOutput.reduce((sum, row) => sum + (row?.actualMW ?? 0), 0);

  return NextResponse.json({
    totalPlants: plants.length,
    totalCapacityMW,
    currentOutputMW,
    totalAlerts,
    openAlerts,
    activeModels,
  });
}
