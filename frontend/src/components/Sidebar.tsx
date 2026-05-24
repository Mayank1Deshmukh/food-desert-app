"use client";

import { ChicagoData, MarketPin, ScoreMetrics } from "@/types";

interface SidebarProps {
  data: ChicagoData;
  markets: MarketPin[];
  scoreMetrics: ScoreMetrics;
  onSpawnClick: () => void;
  onRemoveMarket: (id: string) => void;
  pendingSpawn: boolean;
}

export default function Sidebar({
  data,
  markets,
  scoreMetrics,
  onSpawnClick,
  onRemoveMarket,
  pendingSpawn,
}: SidebarProps) {
  const { totalScoreReduction, avgDistReduction, improvedTractCount } = scoreMetrics;

  return (
    <aside className="w-96 bg-white shadow-xl flex flex-col h-full z-10 relative">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="p-6 border-b border-gray-100">
        <h1 className="text-2xl font-bold text-gray-800">Food Oasis</h1>
        <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wider mt-1">
          {data.cityName} · Sandbox Mode
        </h2>
      </div>

      <div className="p-6 flex-grow overflow-y-auto space-y-6">

        {/* ── Dataset info ───────────────────────────────────────────────────── */}
        <div className="bg-blue-50 rounded-lg p-4 border border-blue-100">
          <p className="text-sm text-blue-800 font-medium">
            Analyzing{" "}
            <span className="font-bold">
              {data.tractsGeoJSON.features?.length?.toLocaleString() ?? 0}
            </span>{" "}
            census tracts
          </p>
          <p className="text-sm text-blue-800 font-medium mt-1">
            Tracking{" "}
            <span className="font-bold">{data.existingStores.length}</span>{" "}
            existing grocers
          </p>
        </div>

        {/* ── Spawn button ───────────────────────────────────────────────────── */}
        <button
          onClick={onSpawnClick}
          disabled={pendingSpawn}
          className={`w-full py-3 rounded-lg font-semibold text-sm transition-all duration-150 shadow-sm
            ${pendingSpawn
              ? "bg-emerald-200 text-emerald-700 cursor-wait"
              : "bg-emerald-600 text-white hover:bg-emerald-700 active:scale-95"
            }`}
        >
          {pendingSpawn ? "Placing pin…" : "+ Spawn Market"}
        </button>

        <p className="text-xs text-gray-400 -mt-3 text-center leading-relaxed">
          Places a draggable pin at the map centre.
          <br />
          Drag it — the heatmap recalculates in real time.
        </p>

        {/* ── Global impact metrics ──────────────────────────────────────────── */}
        {markets.length > 0 && (
          <div className="space-y-2">
            <h3 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">
              City-wide Impact
            </h3>
            <div className="grid grid-cols-3 gap-2">
              {/* Markets deployed */}
              <div className="bg-gray-50 rounded-lg p-3 border border-gray-100 text-center">
                <p className="text-xl font-bold text-gray-800">{markets.length}</p>
                <p className="text-xs text-gray-500 mt-0.5 leading-tight">
                  Markets<br />Deployed
                </p>
              </div>

              {/* Priority score reduction */}
              <div className="bg-emerald-50 rounded-lg p-3 border border-emerald-100 text-center">
                <p className="text-xl font-bold text-emerald-700">
                  {improvedTractCount > 0
                    ? `−${totalScoreReduction.toFixed(0)}`
                    : "—"}
                </p>
                <p className="text-xs text-emerald-600 mt-0.5 leading-tight">
                  Score<br />Reduced
                </p>
              </div>

              {/* Average distance saved */}
              <div className="bg-indigo-50 rounded-lg p-3 border border-indigo-100 text-center">
                <p className="text-xl font-bold text-indigo-700">
                  {improvedTractCount > 0
                    ? `−${avgDistReduction.toFixed(2)}mi`
                    : "—"}
                </p>
                <p className="text-xs text-indigo-600 mt-0.5 leading-tight">
                  Avg Dist<br />Saved
                </p>
              </div>
            </div>

            {improvedTractCount > 0 && (
              <p className="text-xs text-gray-400 leading-relaxed">
                {improvedTractCount.toLocaleString()} tract
                {improvedTractCount !== 1 ? "s" : ""} now have a closer grocery
                option than any existing store. The heatmap reflects recalculated
                scores using the same formula as the pipeline.
              </p>
            )}
          </div>
        )}

        {/* ── Deployed Markets ledger ────────────────────────────────────────── */}
        <div>
          <h3 className="font-semibold text-gray-800 mb-3">Deployed Markets</h3>

          {markets.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-200 p-6 text-center">
              <p className="text-sm text-gray-400">No markets deployed yet.</p>
              <p className="text-xs text-gray-300 mt-1">
                Click &ldquo;Spawn Market&rdquo; to get started.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {markets.map((m) => (
                <div
                  key={m.id}
                  className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 shadow-sm"
                >
                  <div className="flex items-start gap-3">
                    {/* Name badge */}
                    <span className="mt-0.5 flex-shrink-0 w-7 h-7 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xs font-bold">
                      {m.name[0]}
                    </span>

                    {/* Pin data */}
                    <div className="flex-grow min-w-0">
                      <p className="text-sm font-semibold text-emerald-800 truncate">
                        Market {m.name}
                      </p>
                      <p className="font-mono text-xs text-gray-600 mt-0.5 tracking-tight">
                        {m.lat.toFixed(4)},&nbsp;{m.lng.toFixed(4)}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {m.households > 0
                          ? `~${m.households.toLocaleString()} pop. within 0.5 mi`
                          : "Drag pin to calculate coverage"}
                      </p>
                    </div>

                    {/* Remove button */}
                    <button
                      onClick={() => onRemoveMarket(m.id)}
                      title="Remove market"
                      className="flex-shrink-0 self-center p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors duration-150"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-4 w-4"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                        <path d="M10 11v6M14 11v6" />
                        <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Methodology note ───────────────────────────────────────────────── */}
        {markets.length > 0 && (
          <p className="text-xs text-gray-400 leading-relaxed">
            ✦ Score formula: <code className="bg-gray-100 px-1 rounded">100 / (1 + d¹·⁵)</code> where
            d = miles to nearest grocery (existing stores or deployed pins).
            Gradient anchored to original city-wide max — colours are directly comparable
            to the baseline map.
          </p>
        )}

      </div>
    </aside>
  );
}
