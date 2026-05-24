"use client";

import dynamic from "next/dynamic";
import { ChicagoData, MarketPin, ScoreMetrics } from "@/types";

const DynamicMap = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-gray-100 rounded-xl">
      <p className="text-gray-500 font-medium animate-pulse">Loading map data…</p>
    </div>
  ),
});

interface MapWrapperProps {
  data: ChicagoData;
  markets: MarketPin[];
  pendingSpawn: boolean;
  onSpawned: (lat: number, lng: number) => void;
  onMarketDragEnd: (id: string, lat: number, lng: number, households: number) => void;
  onScoresUpdated: (metrics: ScoreMetrics) => void;
}

export default function MapWrapper(props: MapWrapperProps) {
  return (
    <div className="h-full w-full">
      <DynamicMap {...props} />
    </div>
  );
}
