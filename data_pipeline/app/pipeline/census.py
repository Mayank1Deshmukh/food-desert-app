import requests
import pandas as pd
import geopandas as gpd
from app.core.config import STATE_FIPS, COUNTY_FIPS, CENSUS_API_KEY, CRS_WGS84

def fetch_chicago_tracts() -> gpd.GeoDataFrame:
    """Downloads Cook County tract shapes from Census TIGER database."""
    print("Downloading tract boundaries for Chicago area (Cook County)...")
    url = f"https://www2.census.gov/geo/tiger/TIGER2022/TRACT/tl_2022_{STATE_FIPS}_tract.zip"
    
    gdf = gpd.read_file(url)
    # Filter strictly to Cook County
    gdf = gdf[gdf['COUNTYFP'] == COUNTY_FIPS]
    
    return gdf[['GEOID', 'geometry']].to_crs(CRS_WGS84)

def fetch_chicago_population() -> pd.DataFrame:
    """Downloads population metrics from Census ACS API."""

    # Fail fast with an actionable message rather than a cryptic JSONDecodeError.
    # The Census API returns HTTP 200 with an HTML "Missing Key" page when the
    # key is absent or empty, which bypasses raise_for_status() silently.
    if not CENSUS_API_KEY:
        raise EnvironmentError(
            "\n"
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
            "  CENSUS_API_KEY is not set.\n"
            "\n"
            "  Get a free key (instant) at:\n"
            "    https://api.census.gov/data/key_signup.html\n"
            "\n"
            "  Then set it before running the pipeline:\n"
            "    Windows PowerShell:\n"
            "      $env:CENSUS_API_KEY = 'your_key_here'\n"
            "    Windows CMD:\n"
            "      set CENSUS_API_KEY=your_key_here\n"
            "    macOS/Linux:\n"
            "      export CENSUS_API_KEY=your_key_here\n"
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        )

    print("Fetching population markers from Census API...")
    url = (
        f"https://api.census.gov/data/2021/acs/acs5?get=NAME,B01003_001E"
        f"&for=tract:*&in=state:{STATE_FIPS}&in=county:{COUNTY_FIPS}"
        f"&key={CENSUS_API_KEY}"
    )

    response = requests.get(url, timeout=30)
    response.raise_for_status()

    # Guard against the Census API returning an HTML error page with HTTP 200.
    # This happens with an invalid/expired key and would otherwise produce a
    # confusing JSONDecodeError further down the stack.
    content_type = response.headers.get("Content-Type", "")
    if "html" in content_type or response.text.strip().startswith("<"):
        raise ValueError(
            f"Census API returned HTML instead of JSON — the key may be invalid or not yet activated.\n"
            f"Response preview: {response.text[:300]}"
        )

    data = response.json()
    
    df = pd.DataFrame(data[1:], columns=data[0])
    df['GEOID'] = df['state'] + df['county'] + df['tract']
    df = df.rename(columns={'B01003_001E': 'population'})
    df['population'] = pd.to_numeric(df['population'], errors='coerce').fillna(0)
    
    return df[['GEOID', 'population']]

def get_chicago_base_data() -> gpd.GeoDataFrame:
    """Merges geography and population into one single dataframe."""
    geo_df = fetch_chicago_tracts()
    pop_df = fetch_chicago_population()
    return geo_df.merge(pop_df, on='GEOID', how='inner')