import geopandas as gpd
import pandas as pd
from pyproj import CRS as ProjCRS
from app.core.config import CRS_WGS84


def _crs_uses_feet(crs_string: str) -> bool:
    """
    Returns True if the CRS measures distance in feet (US survey or imperial).
    Replaces the brittle substring check ("2229" in local_crs) which failed to
    catch EPSG:3435 (NAD83 / Illinois East ftUS) and any other foot-based CRS
    not in the hard-coded list.
    """
    try:
        crs = ProjCRS.from_user_input(crs_string)
        unit = crs.axis_info[0].unit_name.lower()
        return "foot" in unit or "feet" in unit
    except Exception:
        # Fallback: explicit list of common foot-based EPSG codes
        return any(code in crs_string for code in ("3435", "3436", "2229", "2263"))

def calculate_food_access_scores(tracts_gdf: gpd.GeoDataFrame, stores_gdf: gpd.GeoDataFrame, local_crs: str) -> gpd.GeoDataFrame:
    """
    Calculates the baseline food access score for each tract.
    High population density + far distance from a grocery store = Low Access (Food Desert)
    """
    # Bug 1 fix: drop uninhabited tracts (water bodies, parks with population = 0)
    # before scoring.  Their pop_density is 0, so access_score = 1/distance, which
    # is orders of magnitude higher than any real residential tract and completely
    # dominates min-max normalisation — pushing every inhabited tract to ~100
    # desert_priority with no gradient.
    tracts_gdf = tracts_gdf[tracts_gdf["population"] > 0].copy()

    print("Projecting layers to local meter/feet CRS for accurate distance math...")
    # Project layers to local projection system for accurate distance measurements
    tracts_projected = tracts_gdf.to_crs(local_crs)
    stores_projected = stores_gdf.to_crs(local_crs)

    # Bug 2 fix: detect CRS units via pyproj instead of a brittle substring check.
    # EPSG:3435 (NAD83 / Illinois East ftUS) is in US survey feet but the old check
    # ("2229" in local_crs or "2263" in local_crs) evaluated to False for it.
    is_feet = _crs_uses_feet(local_crs)
    
    # Calculate centroids of each tract
    tracts_projected['centroid'] = tracts_projected.geometry.centroid
    
    print("Calculating distances to nearest grocery store...")
    # Find the distance from each tract centroid to the nearest grocery store
    min_distances = []
    divisor = 5280 if is_feet else 1609.34
    for centroid in tracts_projected['centroid']:
        distances = stores_projected.geometry.distance(centroid)
        distance_miles = distances.min() / divisor
        min_distances.append(max(distance_miles, 0.1))  # 0.1-mile floor prevents /0
        
    tracts_projected['distance_to_store_miles'] = min_distances
    
    # Calculate Food Access Score: Inverse Distance weighted by Population Density
    # Area is calculated in square miles
    conversion_factor = (5280 ** 2) if is_feet else (1609.34 ** 2)
    tracts_projected['area_sq_miles'] = tracts_projected.geometry.area / conversion_factor
    
    # Handle tracts with zero area safely
    tracts_projected['area_sq_miles'] = tracts_projected['area_sq_miles'].replace(0, 0.01)
    tracts_projected['pop_density'] = tracts_projected['population'] / tracts_projected['area_sq_miles']
    
    # ── Access score ──────────────────────────────────────────────────────────
    # Anchored to the USDA urban food-desert threshold of 1 mile.
    # Formula: 100 / (1 + distance^1.5)
    #
    # Population density is intentionally excluded from this signal — it made
    # dense urban neighbourhoods score *worse* than sparse rural tracts at the
    # same distance, which is the wrong direction for a colour map.  Density
    # still drives the optimiser via:  weight = population × desert_priority.
    #
    # Benchmark values (no normalisation needed — scale is absolute):
    #   0.25 mi →  88  (well served, green)
    #   0.50 mi →  74  (good access, light green)
    #   1.00 mi →  50  (USDA borderline, yellow)
    #   2.00 mi →  24  (limited access, orange)
    #   5.00 mi →   8  (poor access, red)
    #  10.00 mi →   3  (severe desert, deep red)
    tracts_projected['access_score'] = (
        100 / (1 + tracts_projected['distance_to_store_miles'] ** 1.5)
    )

    # Invert: higher number = higher food desert priority = hotter map colour
    tracts_projected['desert_priority'] = 100 - tracts_projected['access_score']
    
    # Return to standard WGS84 coordinates for web frontend compatibility
    return tracts_projected.drop(columns=['centroid']).to_crs(CRS_WGS84)