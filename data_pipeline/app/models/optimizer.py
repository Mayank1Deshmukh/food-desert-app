import numpy as np
import pandas as pd
import geopandas as gpd
from sklearn.cluster import KMeans
from app.core.config import CRS_WGS84
from app.core.spatial import _crs_uses_feet

def precalculate_market_placements(tracts_gdf: gpd.GeoDataFrame, local_crs: str, max_markets: int = 5) -> dict:
    """
    Locates optimal points for N mobile markets.
    Weights locations by population density and baseline food desert priority score.
    """
    optimization_results = {}
    
    # Filter for target tracts that fall into priority tiers (worst 40% of access scores)
    threshold = tracts_gdf['desert_priority'].quantile(0.60)
    deserts_gdf = tracts_gdf[tracts_gdf['desert_priority'] >= threshold].copy()
    
    if deserts_gdf.empty or len(deserts_gdf) < max_markets:
        deserts_gdf = tracts_gdf.copy()
        
    # Project to extract precise coordinates in meters/feet for KMeans
    deserts_projected = deserts_gdf.to_crs(local_crs)
    
    # Extract coordinates of tract centroids
    centroids = deserts_projected.geometry.centroid
    X = np.array([[c.x, c.y] for c in centroids])
    
    # Sample weights based on population and desert severity index
    weights = deserts_projected['population'] * deserts_projected['desert_priority']
    weights = weights.fillna(0) + 1 # avoid zero weights
    
    # Run optimization for every possible step selection (N=1 to N=5)
    for n in range(1, max_markets + 1):
        print(f"Pre-calculating configuration for N = {n} markets...")
        
        # Use KMeans clustered coordinates weighted by demand
        kmeans = KMeans(n_clusters=n, random_state=42, n_init=10)
        kmeans.fit(X, sample_weight=weights)
        
        # Convert optimized center points back into a GeoDataFrame to reproject to Lat/Lon
        optimized_points_projected = gpd.GeoSeries(gpd.points_from_xy(kmeans.cluster_centers_[:, 0], kmeans.cluster_centers_[:, 1]), crs=local_crs)
        optimized_points_wgs84 = optimized_points_projected.to_crs(CRS_WGS84)
        
        # Format coordinate array for Next.js map display
        market_coordinates = [{"id": i, "lat": point.y, "lng": point.x} for i, point in enumerate(optimized_points_wgs84)]
        
        # Calculate impact metric: how many households are rescued?
        total_rescued_pop = calculate_population_reached(tracts_gdf, optimized_points_wgs84, local_crs)
        
        optimization_results[str(n)] = {
            "markets": market_coordinates,
            "metrics": {
                "population_served": int(total_rescued_pop),
                "households_served": int(total_rescued_pop / 2.6) # Standard US Census household size scaling factor
            }
        }
        
    return optimization_results

def calculate_population_reached(tracts_gdf: gpd.GeoDataFrame, market_points_wgs84: gpd.GeoSeries, local_crs: str, radius_miles: float = 0.5) -> float:
    """
    Computes total population residing within a 0.5-mile boundary radius of any active placement.
    """
    # Project to calculate precise spatial buffers
    tracts_proj = tracts_gdf.to_crs(local_crs)
    markets_proj = gpd.GeoDataFrame(geometry=market_points_wgs84, crs=CRS_WGS84).to_crs(local_crs)
    
    # Generate 0.5 mile buffers (1 mile = 1609.34 meters or 5280 feet)
    buffer_distance = radius_miles * (5280 if _crs_uses_feet(local_crs) else 1609.34)
    
    market_buffers = markets_proj.geometry.buffer(buffer_distance)
    unified_buffer = market_buffers.unary_union # Merge overlapping circles to prevent double counting residents
    
    # Find tracts that intersect the buffer zone
    intersecting_tracts = tracts_proj[tracts_proj.geometry.intersects(unified_buffer)]
    
    # Sum up the population caught inside
    return intersecting_tracts['population'].sum()