"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import {
  MapContainer,
  TileLayer,
  GeoJSON,
  Circle,
  CircleMarker,
  Marker,
  Tooltip,
  useMap,
} from "react-leaflet";
import { ChicagoData, MarketPin, ScoreMetrics } from "@/types";
import { useEffect, useRef, useMemo, useCallback } from "react";
import type { PathOptions } from "leaflet";
import type { Feature, Polygon, MultiPolygon } from "geojson";

// ── Module-level Leaflet icon ─────────────────────────────────────────────────

const MARKET_ICON = L.divIcon({
  className: "",
  html: `<div style="
    width:28px; height:28px;
    background:#10b981;
    border:3px solid #059669;
    border-radius:50% 50% 50% 0;
    transform:rotate(-45deg);
    box-shadow:0 2px 6px rgba(0,0,0,0.3);
  "></div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 28],
  tooltipAnchor: [14, -28],
});

// ── Geometry helpers ──────────────────────────────────────────────────────────

function polyCentroid(feature: Feature): [number, number] | null {
  const g = feature.geometry;
  if (!g) return null;
  const ring =
    g.type === "Polygon"
      ? (g as Polygon).coordinates[0]
      : g.type === "MultiPolygon"
      ? (g as MultiPolygon).coordinates[0][0]
      : null;
  if (!ring || ring.length === 0) return null;
  const lat = ring.reduce((s, c) => s + c[1], 0) / ring.length;
  const lng = ring.reduce((s, c) => s + c[0], 0) / ring.length;
  return [lat, lng];
}

/** Haversine distance between two WGS-84 points, in miles. */
function haversineMiles(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Mirrors the Python pipeline (spatial.py lines 83-88) exactly:
 *
 *   access_score   = 100 / (1 + d^1.5)   ← high when d is small (good access)
 *   desert_priority = 100 − access_score  ← high when d is large (bad access)
 *
 * Benchmark (matches the pipeline's own comment):
 *   0.25 mi →  12  (well served, green)
 *   0.50 mi →  26  (good access)
 *   1.00 mi →  50  (USDA borderline, yellow)
 *   2.00 mi →  76  (limited access, orange)
 *   5.00 mi →  92  (poor access, red)
 *  10.00 mi →  97  (severe desert, deep red)
 */
function desertPriority(distMiles: number): number {
  return 100 - 100 / (1 + Math.pow(distMiles, 1.5));
}

// ── Colour helpers ────────────────────────────────────────────────────────────

/**
 * Maps a priority score onto the red→amber→green gradient.
 * score/max → t in [0,1] → hue 0 (red) to 120 (green).
 * Lower score (pin improved the tract) → lower t → greener hue.
 */
function tractColor(score: number, max: number): string {
  if (!score || max === 0) return "#e5e7eb";
  const t = Math.min(score / max, 1);
  const hue = Math.round(120 * (1 - t));
  return `hsl(${hue}, 75%, 45%)`;
}

// ── Map utilities ─────────────────────────────────────────────────────────────

function MapResizer() {
  const map = useMap();
  useEffect(() => {
    const timer = setTimeout(() => map.invalidateSize(), 100);
    return () => clearTimeout(timer);
  }, [map]);
  return null;
}

function SpawnTrigger({
  pendingSpawn,
  onSpawned,
}: {
  pendingSpawn: boolean;
  onSpawned: (lat: number, lng: number) => void;
}) {
  const map = useMap();
  const firedRef = useRef(false);

  useEffect(() => {
    if (pendingSpawn && !firedRef.current) {
      firedRef.current = true;
      const { lat, lng } = map.getCenter();
      onSpawned(lat, lng);
    }
    if (!pendingSpawn) {
      firedRef.current = false;
    }
  }, [pendingSpawn, map, onSpawned]);

  return null;
}

// ── DraggableMarker ───────────────────────────────────────────────────────────

/**
 * Extended centroid record.  Built once at mount from the GeoJSON + store list.
 *
 * baseMinDist  — haversine miles to the nearest real grocery store.
 *               This is the threshold a dropped pin must beat before its
 *               position counts as an improvement for this tract.
 * originalScore — the pipeline's desert_priority for the unchanged city.
 */
interface TractCentroid {
  geoid: string;
  population: number;
  originalScore: number;
  baseMinDist: number;
  center: [number, number];
}

interface DraggableMarkerProps {
  market: MarketPin;
  tractCentroids: TractCentroid[];
  onDragEnd: (id: string, lat: number, lng: number, households: number) => void;
}

/**
 * Draggable pin + service-radius circle.
 *
 * The circle is moved imperatively (Leaflet ref) during `drag` so there are
 * zero React re-renders mid-drag — keeping the Marker's `position` prop from
 * being reset to spawn coordinates by React-Leaflet on every frame.
 */
function DraggableMarker({ market, tractCentroids, onDragEnd }: DraggableMarkerProps) {
  const markerRef = useRef<L.Marker>(null);
  const circleRef = useRef<L.Circle>(null);

  const handlers = useMemo(
    () => ({
      drag() {
        const marker = markerRef.current;
        const circle = circleRef.current;
        if (!marker || !circle) return;
        circle.setLatLng(marker.getLatLng()); // imperative, no setState
      },
      dragend() {
        const marker = markerRef.current;
        if (!marker) return;
        const { lat, lng } = marker.getLatLng();
        // Per-pin 0.5-mile household count for the ledger display
        const households = tractCentroids
          .filter((t) => haversineMiles(t.center[0], t.center[1], lat, lng) <= 0.5)
          .reduce((sum, t) => sum + t.population, 0);
        onDragEnd(market.id, lat, lng, households);
      },
    }),
    [market.id, tractCentroids, onDragEnd]
  );

  return (
    <>
      <Marker
        ref={markerRef}
        position={[market.lat, market.lng]}
        icon={MARKET_ICON}
        draggable
        eventHandlers={handlers}
      >
        <Tooltip permanent direction="top" offset={[0, -32]}>
          <span className="font-semibold">Market {market.name}</span>
        </Tooltip>
      </Marker>

      <Circle
        ref={circleRef}
        center={[market.lat, market.lng]}
        radius={804.67}
        pathOptions={{
          fillColor: "#10b981",
          fillOpacity: 0.12,
          color: "#059669",
          weight: 2,
          dashArray: "8 5",
        }}
      />
    </>
  );
}

// ── Component props ───────────────────────────────────────────────────────────

interface MapViewProps {
  data: ChicagoData;
  markets: MarketPin[];
  pendingSpawn: boolean;
  onSpawned: (lat: number, lng: number) => void;
  onMarketDragEnd: (id: string, lat: number, lng: number, households: number) => void;
  onScoresUpdated: (metrics: ScoreMetrics) => void;
}

// ── MapView ───────────────────────────────────────────────────────────────────

export default function MapView({
  data,
  markets,
  pendingSpawn,
  onSpawned,
  onMarketDragEnd,
  onScoresUpdated,
}: MapViewProps) {
  const mapCenter: [number, number] = [41.8781, -87.6298];

  // ── Filter water-only tracts ───────────────────────────────────────────────
  const inhabitedTracts = useMemo(
    () => ({
      ...data.tractsGeoJSON,
      features: data.tractsGeoJSON.features.filter(
        (f) => (f.properties?.population as number) > 0
      ),
    }),
    [data]
  );

  // ── Pre-compute centroids + baseline store distances (once at mount) ───────
  //
  // For each inhabited tract we find:
  //   center       — polygon centroid (fast approximation via ring average)
  //   baseMinDist  — miles to the nearest of the 251 real grocery stores
  //   originalScore — fixed pipeline score; used as the gradient anchor
  //
  // Cost: ~1,300 tracts × 251 stores ≈ 326 k haversine calls.
  // Runs once; Vercel serves no backend; all compute stays in the user's JS engine.
  const tractCentroids = useMemo<TractCentroid[]>(() => {
    const stores = data.existingStores;
    return inhabitedTracts.features.flatMap((f) => {
      const center = polyCentroid(f);
      if (!center) return [];

      let baseMinDist = Infinity;
      for (const store of stores) {
        const d = haversineMiles(center[0], center[1], store.lat, store.lng);
        if (d < baseMinDist) baseMinDist = d;
      }

      return [
        {
          geoid: String(f.properties?.GEOID ?? ""),
          population: (f.properties?.population as number) ?? 0,
          originalScore: (f.properties?.desert_priority as number) ?? 0,
          baseMinDist: isFinite(baseMinDist) ? baseMinDist : 99,
          center,
        },
      ];
    });
  }, [inhabitedTracts, data.existingStores]);

  // ── Max score anchor for the colour gradient (fixed to original data) ──────
  const maxScore = useMemo(
    () => Math.max(0, ...tractCentroids.map((t) => t.originalScore)),
    [tractCentroids]
  );

  // ── Dynamic score recalculation ────────────────────────────────────────────
  //
  // On every markets change, iterate all tracts in a single pass:
  //   1. Find minPinDist = closest deployed market to this tract centroid.
  //   2. If minPinDist < baseMinDist, the pin beats the real store network.
  //   3. Recalculate score with the same formula as the Python pipeline:
  //        newScore = 100 / (1 + minPinDist ^ 1.5)
  //   4. Accumulate aggregate metrics in the same loop (no duplicate work).
  //
  // updatedScores  — Map<geoid, newScore> consumed by tractStyle.
  // scoreMetrics   — aggregates bubbled up to the sidebar via onScoresUpdated.
  const { updatedScores, scoreMetrics } = useMemo(() => {
    const scores = new Map<string, number>();
    let totalScoreReduction = 0;
    let totalDistReduction = 0;

    if (markets.length > 0) {
      for (const tract of tractCentroids) {
        let minPinDist = Infinity;
        for (const m of markets) {
          const d = haversineMiles(tract.center[0], tract.center[1], m.lat, m.lng);
          if (d < minPinDist) minPinDist = d;
        }

        if (minPinDist < tract.baseMinDist) {
          const newScore = desertPriority(minPinDist);
          scores.set(tract.geoid, newScore);
          totalScoreReduction += tract.originalScore - newScore;
          totalDistReduction += tract.baseMinDist - minPinDist;
        }
      }
    }

    const improvedTractCount = scores.size;
    const avgDistReduction =
      improvedTractCount > 0 ? totalDistReduction / improvedTractCount : 0;

    return {
      updatedScores: scores,
      scoreMetrics: {
        totalScoreReduction,
        avgDistReduction,
        improvedTractCount,
      } as ScoreMetrics,
    };
  }, [markets, tractCentroids]);

  // ── Bubble aggregate metrics to DashboardClient → Sidebar ─────────────────
  useEffect(() => {
    onScoresUpdated(scoreMetrics);
  }, [scoreMetrics, onScoresUpdated]);

  // ── GeoJSON remount key ────────────────────────────────────────────────────
  // Changes on every dragend so Leaflet re-runs tractStyle for every feature.
  const geojsonKey =
    markets.map((m) => `${m.id}:${m.lat.toFixed(5)}:${m.lng.toFixed(5)}`).join("|") ||
    "empty";

  // ── Tract style — pure gradient, no hardcoded emerald ─────────────────────
  //
  // If a pin beats the store network for a tract we use its new (lower) score.
  // Lower score → smaller t → hue closer to 120° (green).
  // The gradient anchor (maxScore) stays fixed to the original data so the
  // colour scale doesn't shift as pins are added.
  const tractStyle = useCallback(
    (feature?: Feature): PathOptions => {
      const geoid = String(feature?.properties?.GEOID ?? "");
      const originalScore = (feature?.properties?.desert_priority as number) ?? 0;
      const score = updatedScores.get(geoid) ?? originalScore;
      return {
        fillColor: tractColor(score, maxScore),
        fillOpacity: 0.65,
        color: "#6b7280",
        weight: 0.5,
      };
    },
    [updatedScores, maxScore]
  );

  // ── Stable onDragEnd forwarding ────────────────────────────────────────────
  const handleMarkerDragEnd = useCallback(
    (id: string, lat: number, lng: number, households: number) => {
      onMarketDragEnd(id, lat, lng, households);
    },
    [onMarketDragEnd]
  );

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div style={{ height: "100%", width: "100%", position: "relative" }}>
      <MapContainer
        center={mapCenter}
        zoom={11}
        style={{ height: "100%", width: "100%" }}
        className="rounded-xl shadow-inner z-0"
        preferCanvas={true}
      >
        <MapResizer />
        <SpawnTrigger pendingSpawn={pendingSpawn} onSpawned={onSpawned} />

        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {/* Census tract heatmap — remounts when geojsonKey changes */}
        <GeoJSON
          key={geojsonKey}
          data={inhabitedTracts}
          style={tractStyle}
          onEachFeature={(feature, layer) => {
            const p = feature.properties ?? {};
            const geoidStr = String(p.GEOID ?? "");
            const origScore =
              p.desert_priority != null ? Number(p.desert_priority).toFixed(1) : "N/A";
            const newScore = updatedScores.has(geoidStr)
              ? updatedScores.get(geoidStr)!.toFixed(1)
              : null;
            const pop =
              p.population != null ? Number(p.population).toLocaleString() : "N/A";

            const scoreHtml = newScore
              ? `<span style="color:#059669;font-weight:600">${newScore}</span>` +
                ` <span style="color:#9ca3af;font-size:0.8em">(was&nbsp;${origScore})</span>`
              : origScore;

            layer.bindTooltip(
              `<strong>Tract ${geoidStr || "N/A"}</strong><br/>` +
                `Priority Score: ${scoreHtml}<br/>Population: ${pop}`,
              { sticky: true }
            );
          }}
        />

        {/* Existing grocery stores */}
        {data.existingStores.map((store, i) => (
          <CircleMarker
            key={i}
            center={[store.lat, store.lng]}
            radius={5}
            pathOptions={{
              fillColor: "#22c55e",
              fillOpacity: 0.9,
              color: "#15803d",
              weight: 1,
            }}
          >
            <Tooltip>Grocery Store</Tooltip>
          </CircleMarker>
        ))}

        {/* Draggable market pins */}
        {markets.map((m) => (
          <DraggableMarker
            key={m.id}
            market={m}
            tractCentroids={tractCentroids}
            onDragEnd={handleMarkerDragEnd}
          />
        ))}
      </MapContainer>
    </div>
  );
}
