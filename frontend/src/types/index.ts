export interface StoreLocation {
  lat: number;
  lng: number;
}

export interface ChicagoData {
  cityName: string;
  tractsGeoJSON: GeoJSON.FeatureCollection;
  existingStores: StoreLocation[];
  optimizationMatrix: any[];
}

/** Aggregate impact metrics emitted by MapView after each pin change. */
export interface ScoreMetrics {
  /** Sum of (originalScore − newScore) across every tract a pin improves */
  totalScoreReduction: number;
  /** Average reduction in miles-to-nearest-store across improved tracts */
  avgDistReduction: number;
  /** Number of tracts where at least one pin beats the existing store network */
  improvedTractCount: number;
}

/** A single user-placed, draggable mobile market pin. */
export interface MarketPin {
  /** Unique string id, e.g. "market-1" */
  id: string;
  /** Display name, cycles through Greek alphabet */
  name: string;
  lat: number;
  lng: number;
  /** Population within 0.5 mi — shown in per-pin ledger, computed on dragend */
  households: number;
}