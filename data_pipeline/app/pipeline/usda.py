import os
import re
import requests
import pandas as pd
import geopandas as gpd
from shapely.geometry import Point
from app.core.config import CRS_WGS84, DATA_DIR

# ── Data source ──────────────────────────────────────────────────────────────
# Chicago Data Portal  — Grocery Store Status (BACP survey)
# Portal page: https://data.cityofchicago.org/Health-Human-Services/Grocery-Store-Status/3e26-zek2
#
# If the dataset ID ever changes, update CHICAGO_STORES_ENDPOINT.
# You can find the correct JSON endpoint on the portal under "API" → "API Endpoint".
CHICAGO_STORES_ENDPOINT = "https://data.cityofchicago.org/resource/3e26-zek2.json"

# Bug 1 fix: always override Socrata's 1,000-row default page size.
# 50,000 is well above the ~260 grocery entries in this dataset.
FETCH_PARAMS = {
    "$limit": 50000,
    "$offset": 0,
}

# Bug 2 fix: accept any casing of "open" — the portal has a mix of 'Open', 'OPEN', etc.
# Add any other active-status values here if the dataset schema changes.
OPEN_STATUSES = {"open"}

# Bug 3 fix: compiled regex to parse Socrata's WKT POINT strings.
# Socrata format: "POINT (-87.6298 41.8781)"
#   - Longitude comes FIRST in WKT (X axis), latitude second (Y axis).
#   - Allows optional whitespace and is case-insensitive.
_POINT_RE = re.compile(
    r"POINT\s*\(\s*(-?\d+\.?\d*)\s+(-?\d+\.?\d*)\s*\)",
    re.IGNORECASE,
)

# Minimum store count before we treat a cached file as a stale mock and re-fetch.
# The Overpass fallback wrote exactly 8 mock entries — anything under 50 is suspect.
_MIN_VALID_STORE_COUNT = 50


def _parse_wkt_point(raw) -> tuple | None:
    """
    Parses a Socrata WKT POINT string into (lng, lat).

    Returns (longitude, latitude) as floats, or None if the string cannot
    be parsed so the caller can silently skip that row.
    """
    if not isinstance(raw, str):
        return None
    m = _POINT_RE.search(raw)
    if not m:
        return None
    try:
        return float(m.group(1)), float(m.group(2))  # (lng, lat) — WKT X-first order
    except ValueError:
        return None


def download_chicago_grocery_data() -> str:
    """
    Downloads all open grocery stores from the Chicago Data Portal (Socrata API)
    and caches them to a local CSV.

    Fixes vs. old Overpass implementation
    ──────────────────────────────────────
    1. Pagination   — appends $limit=50000 so Socrata returns the full dataset,
                      not its default 1,000-row cap.
    2. Status check — case-insensitive comparison, so 'Open', 'OPEN', and 'open'
                      all pass the filter.
    3. Coordinates  — robust WKT POINT parser with regex; falls back from the
                      pre-split latitude/longitude fields gracefully.
    4. Fallback     — raises instead of silently writing 8 mock stores, so
                      failures surface immediately rather than corrupting the cache.
    """
    csv_path = os.path.join(DATA_DIR, "chicago_grocery_stores.csv")

    # ── Cache check ───────────────────────────────────────────────────────────
    if os.path.exists(csv_path):
        cached_df = pd.read_csv(csv_path)
        if len(cached_df) < _MIN_VALID_STORE_COUNT:
            # The old Overpass mock fallback wrote exactly 8 rows. Purge it.
            print(
                f"  Stale/mock cache detected ({len(cached_df)} rows — expected "
                f"{_MIN_VALID_STORE_COUNT}+). Deleting and re-fetching..."
            )
            os.remove(csv_path)
        else:
            print(f"  Found valid cache: {len(cached_df)} stores. Skipping download.")
            return csv_path

    os.makedirs(DATA_DIR, exist_ok=True)

    # ── Fetch ─────────────────────────────────────────────────────────────────
    print("Fetching Chicago grocery stores from the Chicago Data Portal...")
    print(f"  Endpoint : {CHICAGO_STORES_ENDPOINT}")
    print(f"  $limit   : {FETCH_PARAMS['$limit']}")

    response = requests.get(CHICAGO_STORES_ENDPOINT, params=FETCH_PARAMS, timeout=60)
    response.raise_for_status()
    records = response.json()  # list[dict]
    print(f"  API returned {len(records)} raw records.")

    # ── Parse & filter ────────────────────────────────────────────────────────
    rows: list[dict] = []
    skipped_status = 0
    skipped_coords = 0

    for rec in records:
        # Bug 2 fix: field is "new_status" in this dataset, not "status".
        # Check both so the code survives a future schema rename.
        # Lower-case before comparing so 'Open', 'OPEN', 'open' all match.
        raw_status = str(rec.get("new_status") or rec.get("status") or "").strip().lower()
        if raw_status not in OPEN_STATUSES:
            skipped_status += 1
            continue

        # Bug 3 fix: this dataset returns location as a GeoJSON dict
        #   {"type": "Point", "coordinates": [lng, lat]}
        # rather than a WKT string.  Handle both formats, plus pre-split fields.
        lat = rec.get("latitude") or rec.get("lat")
        lng = rec.get("longitude") or rec.get("lon") or rec.get("lng")

        if lat is not None and lng is not None:
            try:
                lat, lng = float(lat), float(lng)
            except (ValueError, TypeError):
                lat = lng = None  # malformed numeric string — fall through

        if lat is None or lng is None:
            location = rec.get("location", "")

            if isinstance(location, dict):
                # GeoJSON dict: {"type": "Point", "coordinates": [lng, lat]}
                coords = location.get("coordinates")
                if isinstance(coords, (list, tuple)) and len(coords) >= 2:
                    try:
                        lng, lat = float(coords[0]), float(coords[1])
                    except (ValueError, TypeError):
                        skipped_coords += 1
                        continue
                else:
                    skipped_coords += 1
                    continue
            elif isinstance(location, str):
                # WKT string fallback: "POINT (-87.62 41.87)"
                parsed = _parse_wkt_point(location)
                if parsed is None:
                    skipped_coords += 1
                    continue
                lng, lat = parsed
            else:
                skipped_coords += 1
                continue

        rows.append({"lat": lat, "lon": lng})

    # ── Summary ───────────────────────────────────────────────────────────────
    print(
        f"  Kept    : {len(rows)} open stores\n"
        f"  Dropped : {skipped_status} non-open status\n"
        f"  Dropped : {skipped_coords} unparseable coordinates"
    )

    if not rows:
        # Bug 4 fix: raise immediately rather than caching a useless file.
        # To debug, print records[0] to inspect actual field names & status values.
        sample = records[:3] if records else []
        raise RuntimeError(
            f"Zero stores survived filtering — the status or coordinate fields may have "
            f"changed in the source dataset.\n"
            f"First 3 raw records for inspection:\n{sample}\n"
            f"Verify the endpoint and column names at:\n"
            f"  https://data.cityofchicago.org/resource/3e26-zek2.json?$limit=3"
        )

    # ── Persist ───────────────────────────────────────────────────────────────
    df = pd.DataFrame(rows)
    df.to_csv(csv_path, index=False)
    print(f"  Saved {len(df)} stores → {csv_path}")
    return csv_path


def load_chicago_stores(csv_path: str) -> gpd.GeoDataFrame:
    """Loads the cached CSV and returns a GeoDataFrame in WGS84."""
    df = pd.read_csv(csv_path)
    geometry = [Point(row.lon, row.lat) for row in df.itertuples()]
    return gpd.GeoDataFrame(df, geometry=geometry, crs=CRS_WGS84)
