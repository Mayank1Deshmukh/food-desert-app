import os
import json
from app.core.config import CITY_NAME, CRS_CHICAGO, DATA_DIR
from app.pipeline.census import get_chicago_base_data
from app.pipeline.usda import download_chicago_grocery_data, load_chicago_stores
from app.core.spatial import calculate_food_access_scores
from app.models.optimizer import precalculate_market_placements

def build_chicago_data():
    """Compiles everything into a single layout for Chicago."""
    # Write directly to the frontend's data directory
    output_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../frontend/public/data"))
    os.makedirs(output_dir, exist_ok=True)
    
    print(f"=== RUNNING ANALYSIS FOR: {CITY_NAME} ===")
    
    # 1. Gather Data
    tracts_gdf = get_chicago_base_data()
    stores_path = download_chicago_grocery_data()
    stores_gdf = load_chicago_stores(stores_path)
    
    # 2. Run Spatial Computations (using Chicago's local foot projection)
    scored_tracts_gdf = calculate_food_access_scores(tracts_gdf, stores_gdf, CRS_CHICAGO)
    optimized_allocations = precalculate_market_placements(scored_tracts_gdf, CRS_CHICAGO)
    
    # 3. Package Payload
    tracts_geojson = json.loads(scored_tracts_gdf.to_json())
    stores_list = [{"lat": geom.y, "lng": geom.x} for geom in stores_gdf.geometry]
    
    final_payload = {
        "cityName": CITY_NAME,
        "tractsGeoJSON": tracts_geojson,
        "existingStores": stores_list,
        "optimizationMatrix": optimized_allocations
    }
    
    # Save file
    destination_file = os.path.join(output_dir, "chicago.json")
    with open(destination_file, "w") as f:
        json.dump(final_payload, f, indent=2)
        
    print(f"\nSUCCESS! Created {destination_file}")

if __name__ == "__main__":
    build_chicago_data()