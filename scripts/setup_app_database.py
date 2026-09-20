"""Apply migrations and import real traffic observations needed by the local SUMO study.

Fetch first: python scripts/fetch_data.py --source wprdc_traffic_counts
This limited bootstrap does not fabricate crash history or load demo observations.
"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from dotenv import load_dotenv
from scripts.normalize_data import normalize_geojson
from scripts.tiger import connection, insert_intersections, insert_traffic, migrate, selected_intersections


def main():
    load_dotenv(ROOT / '.env')
    data = ROOT / 'data'
    (data / 'normalized').mkdir(exist_ok=True)
    normalize_geojson(data, 'raw/wprdc/traffic_counts/traffic_counts.geojson',
                      'normalized/traffic_counts.parquet')
    with connection(os.getenv('DATABASE_URL')) as conn:
        migrate(conn)
        with conn.transaction():
            selected = selected_intersections(data)
            insert_intersections(conn, selected)
            count = insert_traffic(conn, data, selected)
        print(f'Loaded {count} real traffic observations for {len(selected)} selected intersections.')


if __name__ == '__main__':
    main()
