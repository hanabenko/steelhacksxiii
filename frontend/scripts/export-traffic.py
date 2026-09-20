"""Export the same complete nearby observation used by SUMO, without a database."""
import json
import sys
from pathlib import Path
import geopandas as gpd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from scripts.tiger import nearby, selected_intersections

def bundle():
    site = next(s for s in selected_intersections(ROOT / 'data') if s['id'] == 'fifth-meyran')
    traffic = gpd.read_parquet(ROOT / 'data/normalized/traffic_counts.parquet')
    complete = nearby(traffic, site, 200).dropna(subset=['count_start_date', 'median_speed', 'speed85_percent', 'speed_limit', 'average_daily_car_traffic'])
    row = complete.sort_values('count_start_date', ascending=False).iloc[0]
    return {'source': 'City of Pittsburgh / WPRDC traffic counts',
            'site': 'Fifth / Meyran', 'recordId': str(row['id']),
            'observedAt': str(row['count_start_date']),
            'medianSpeedMph': float(row['median_speed']), 'p85SpeedMph': float(row['speed85_percent']),
            'speedLimitMph': float(row['speed_limit']), 'dailyVehicles': float(row['average_daily_car_traffic']),
            'limitation': 'Nearby observation used as a campus proxy; route mix, acceleration and capacity remain illustrative assumptions.'}

if __name__ == '__main__':
    (ROOT / 'frontend/src/data/traffic-observation.json').write_text(json.dumps(bundle(), indent=2)+'\n', encoding='utf-8')
