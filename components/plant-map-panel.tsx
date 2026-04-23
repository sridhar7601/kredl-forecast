"use client";

import dynamic from "next/dynamic";
import type { PlantStatus } from "@/lib/types";

type PlantMapEntry = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  status: PlantStatus;
  capacityMW: number;
  district: string;
};

const PlantMap = dynamic(() => import("./plant-map").then((mod) => mod.PlantMap), { ssr: false });

export function PlantMapPanel({ plants }: { plants: PlantMapEntry[] }) {
  return <PlantMap plants={plants} />;
}
