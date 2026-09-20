"""Rebuild the offline frontend weather bundle from the checked-in weather module."""
import csv
import json
import sys
from dataclasses import asdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from weather import WEATHER_PROFILES

def bundle():
    days = {}
    with (ROOT / 'weather/data/weather_daily.csv').open(encoding='utf-8') as handle:
        for row in csv.DictReader(handle):
            if row['site_id'] != 'fifth-meyran':
                continue
            condition = 'snow' if int(row['is_snow_day']) else 'storm' if row['weather_group'] == 'storm' else 'rain' if int(row['is_wet_day']) else 'clear'
            days[row['date']] = [condition, float(row['temp_mean_f']), float(row['precipitation_in']), float(row['snowfall_in'])]
    return {'source': 'Open-Meteo / ERA5 (Copernicus), CC-BY 4.0',
            'site': 'Fifth / Meyran — nearby regional proxy for campus',
            'url': 'https://open-meteo.com/en/docs/historical-weather-api',
            'profiles': {key: asdict(value) for key, value in WEATHER_PROFILES.items()}, 'days': days}

if __name__ == '__main__':
    target = ROOT / 'frontend/src/data/weather.json'
    target.write_text(json.dumps(bundle(), separators=(',', ':')) + '\n', encoding='utf-8')
