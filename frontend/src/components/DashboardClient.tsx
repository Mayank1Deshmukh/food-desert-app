"use client";

import { useState, useCallback } from "react";
import Sidebar from "@/components/Sidebar";
import MapWrapper from "@/components/MapWrapper";
import { ChicagoData, MarketPin, ScoreMetrics } from "@/types";

const MARKET_NAMES = [
  "Alpha", "Beta", "Gamma", "Delta", "Epsilon",
  "Zeta", "Eta", "Theta", "Iota", "Kappa",
];

let _counter = 0;
function nextMarketId() {
  _counter += 1;
  return `market-${_counter}`;
}

const EMPTY_METRICS: ScoreMetrics = {
  totalScoreReduction: 0,
  avgDistReduction: 0,
  improvedTractCount: 0,
};

export default function DashboardClient({ data }: { data: ChicagoData }) {
  const [markets, setMarkets] = useState<MarketPin[]>([]);
  const [pendingSpawn, setPendingSpawn] = useState(false);
  /** Aggregate impact metrics pushed up from MapView after every pin change */
  const [scoreMetrics, setScoreMetrics] = useState<ScoreMetrics>(EMPTY_METRICS);

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const handleSpawnClick = useCallback(() => {
    setPendingSpawn(true);
  }, []);

  const handleSpawned = useCallback((lat: number, lng: number) => {
    setPendingSpawn(false);
    const id = nextMarketId();
    setMarkets((prev) => {
      const nameIndex = prev.length % MARKET_NAMES.length;
      return [
        ...prev,
        { id, name: MARKET_NAMES[nameIndex], lat, lng, households: 0 },
      ];
    });
  }, []);

  /**
   * Called by MapView on dragend.
   * Updates position + the 0.5-mi household count for the ledger.
   * The global score metrics arrive separately via onScoresUpdated.
   */
  const handleMarketDragEnd = useCallback(
    (id: string, lat: number, lng: number, households: number) => {
      setMarkets((prev) =>
        prev.map((m) => (m.id === id ? { ...m, lat, lng, households } : m))
      );
    },
    []
  );

  /**
   * Called by MapView's useEffect whenever the recalculated score map changes.
   * Fires after every spawn, drag-drop, or removal.
   */
  const handleScoresUpdated = useCallback((metrics: ScoreMetrics) => {
    setScoreMetrics(metrics);
  }, []);

  const handleRemoveMarket = useCallback((id: string) => {
    setMarkets((prev) => prev.filter((m) => m.id !== id));
  }, []);

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <main className="flex h-screen w-screen overflow-hidden bg-gray-50">
      <Sidebar
        data={data}
        markets={markets}
        scoreMetrics={scoreMetrics}
        onSpawnClick={handleSpawnClick}
        onRemoveMarket={handleRemoveMarket}
        pendingSpawn={pendingSpawn}
      />
      <div className="flex-grow h-full p-4">
        <MapWrapper
          data={data}
          markets={markets}
          pendingSpawn={pendingSpawn}
          onSpawned={handleSpawned}
          onMarketDragEnd={handleMarketDragEnd}
          onScoresUpdated={handleScoresUpdated}
        />
      </div>
    </main>
  );
}
