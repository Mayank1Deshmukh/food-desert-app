import os

# 1. Census API Configuration
CENSUS_API_KEY = os.getenv("CENSUS_API_KEY", "")

# 2. Target Location Focus: Chicago (Cook County, IL)
CITY_NAME = "Chicago, IL"
STATE_FIPS = "17"    # Illinois
COUNTY_FIPS = "031"  # Cook County

# 3. Spatial Reference Projections
CRS_WGS84 = "EPSG:4326"    # GPS Coordinates (for Mapbox/Leaflet)
CRS_CHICAGO = "EPSG:3435"  # NAD83 / Illinois East Projection (for high-accuracy distance math in feet)

# 4. Storage Directories
DATA_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../data"))