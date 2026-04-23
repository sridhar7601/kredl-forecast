"use client";

import "leaflet/dist/leaflet.css";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import L from "leaflet";

type PlantMapEntry = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  status: "ACTIVE" | "MAINTENANCE" | "CURTAILED" | "OFFLINE";
  capacityMW: number;
  district: string;
};

const iconByStatus: Record<PlantMapEntry["status"], L.DivIcon> = {
  ACTIVE: L.divIcon({ html: '<div style="background:#16a34a;width:12px;height:12px;border-radius:9999px"></div>' }),
  MAINTENANCE: L.divIcon({ html: '<div style="background:#d97706;width:12px;height:12px;border-radius:9999px"></div>' }),
  CURTAILED: L.divIcon({ html: '<div style="background:#ea580c;width:12px;height:12px;border-radius:9999px"></div>' }),
  OFFLINE: L.divIcon({ html: '<div style="background:#dc2626;width:12px;height:12px;border-radius:9999px"></div>' }),
};

export function PlantMap({ plants }: { plants: PlantMapEntry[] }) {
  const center: [number, number] = [15.1, 76.4];
  return (
    <div className="h-[360px] overflow-hidden rounded-lg border border-orange-200">
      <MapContainer center={center} zoom={6.8} className="h-full w-full" scrollWheelZoom={false}>
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {plants.map((plant) => (
          <Marker key={plant.id} position={[plant.lat, plant.lng]} icon={iconByStatus[plant.status]}>
            <Popup>
              <div>
                <p className="font-semibold">{plant.name}</p>
                <p>{plant.district}</p>
                <p>
                  {plant.capacityMW} MW · {plant.status}
                </p>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
