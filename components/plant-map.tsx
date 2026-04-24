"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useRef } from "react";

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
const MAP_CENTER: [number, number] = [15.1, 76.4];

export function PlantMap({ plants }: { plants: PlantMapEntry[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }

    // HMR can leave a stale leaflet id on the DOM node.
    if ((container as { _leaflet_id?: number })._leaflet_id) {
      delete (container as { _leaflet_id?: number })._leaflet_id;
    }

    const map = L.map(container, { scrollWheelZoom: false }).setView(MAP_CENTER, 6.8);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
    }).addTo(map);

    plants.forEach((plant) => {
      const marker = L.marker([plant.lat, plant.lng], { icon: iconByStatus[plant.status] }).addTo(map);
      marker.bindPopup(
        `<div><p style="font-weight:600">${plant.name}</p><p>${plant.district}</p><p>${plant.capacityMW} MW · ${plant.status}</p></div>`,
      );
    });

    mapRef.current = map;

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      if ((container as { _leaflet_id?: number })._leaflet_id) {
        delete (container as { _leaflet_id?: number })._leaflet_id;
      }
    };
  }, [plants]);

  return (
    <div className="h-[360px] overflow-hidden rounded-lg border border-orange-200">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
