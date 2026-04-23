import { faker } from "@faker-js/faker";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

faker.seed(42);

export const MOCK_PLANTS = [
  { code: "SV-SOL-001", name: "Pavagada Solar Park Block A", type: "SOLAR_PV", capacityMW: 100, district: "Tumakuru", lat: 14.102, lng: 77.281, status: "ACTIVE" },
  { code: "SV-SOL-002", name: "Koppal Ultra Solar", type: "SOLAR_PV", capacityMW: 60, district: "Koppal", lat: 15.348, lng: 76.155, status: "ACTIVE" },
  { code: "SV-SOL-003", name: "Bidar Solar One", type: "SOLAR_PV", capacityMW: 40, district: "Bidar", lat: 17.913, lng: 77.52, status: "ACTIVE" },
  { code: "SV-SOL-004", name: "Raichur Agro Solar", type: "SOLAR_PV", capacityMW: 20, district: "Raichur", lat: 16.212, lng: 77.353, status: "CURTAILED" },
  { code: "SV-SOL-005", name: "Ballari Canal Top Solar", type: "SOLAR_PV", capacityMW: 15, district: "Ballari", lat: 15.139, lng: 76.921, status: "MAINTENANCE" },
  { code: "SV-SOL-006", name: "Kalaburagi Rural Solar", type: "SOLAR_PV", capacityMW: 5, district: "Kalaburagi", lat: 17.327, lng: 76.834, status: "ACTIVE" },
  { code: "SV-WND-001", name: "Gadag Wind Cluster North", type: "WIND", capacityMW: 50, district: "Gadag", lat: 15.45, lng: 75.64, status: "ACTIVE" },
  { code: "SV-WND-002", name: "Chitradurga Wind Ridge", type: "WIND", capacityMW: 30, district: "Chitradurga", lat: 14.23, lng: 76.4, status: "ACTIVE" },
  { code: "SV-WND-003", name: "Gadag Wind Cluster South", type: "WIND", capacityMW: 10, district: "Gadag", lat: 15.22, lng: 75.89, status: "OFFLINE" },
] as const;

export function buildPlantRows() {
  return MOCK_PLANTS.map((plant, idx) => ({
    ...plant,
    commissionedAt: faker.date.between({ from: new Date(2018, 0, 1), to: new Date(2024, 0, 1) }),
    idx,
  }));
}

if (process.argv[1]?.includes("generate-mock-plants.ts")) {
  const rows = buildPlantRows();
  const outDir = join(process.cwd(), "data");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "mock-plants.json"), JSON.stringify(rows, null, 2));
  // eslint-disable-next-line no-console
  console.log(`Wrote ${rows.length} plants to data/mock-plants.json`);
}
