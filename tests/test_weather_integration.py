import importlib.util
import json
from pathlib import Path

import pytest
from simulation.frontend_contract import validate_frontend_payload, FrontendContractValidationError
from simulation.baseline import _cache_parameters, scenario_cache_path
from simulation.interventions import Scenario

ROOT = Path(__file__).resolve().parents[1]

def test_frontend_bundle_matches_downloaded_data_and_backend_profiles():
    spec = importlib.util.spec_from_file_location('weather_export', ROOT / 'frontend/scripts/export-weather.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert json.loads((ROOT / 'frontend/src/data/weather.json').read_text()) == module.bundle()

def test_contract_accepts_weather_and_rejects_unknown_conditions():
    payload = {'intersection': 'pitt-forbes-bigelow', 'settings': {'conditions': {'weather': 'snow'}}}
    assert validate_frontend_payload(payload)['weather'] == 'snow'
    for value in ['fog', None, {}, 2]:
        payload['settings']['conditions']['weather'] = value
        with pytest.raises(FrontendContractValidationError):
            validate_frontend_payload(payload)

def test_weather_has_separate_cache_identity(tmp_path):
    paths = [scenario_cache_path(_cache_parameters(Scenario('pitt-forbes-bigelow', weather=w), 3, 42, 600, (1.5, 3), 60), tmp_path) for w in ['clear', 'rain', 'storm', 'snow']]
    assert len(set(paths)) == 4
