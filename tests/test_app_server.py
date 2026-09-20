from fastapi.testclient import TestClient
from app_server import app, gemini, voice


def test_services_start_together_and_voice_receives_scene_context():
    with TestClient(app) as client:
        assert client.get('/api/health').json()['status'] == 'ok'
        assert hasattr(gemini.state, 'gemini')
        assert hasattr(voice.state, 'eleven')
        response = client.post('/api/voice/voice/ask', json={
            'question': 'How much budget is left?', 'speak': False,
            'context': {'budget': {'total': 80000, 'spent': 20000}},
        })
        assert response.status_code == 200
        assert '60,000' in response.json()['text']
        assert response.json()['audio_base64'] is None


def test_generation_uses_mounted_client(monkeypatch):
    import gemini.app.main as module
    from dataclasses import replace
    monkeypatch.setattr(module, 'settings', replace(module.settings, offline=True))
    with TestClient(app) as client:
        response = client.post('/api/gemini/generate/simulation_debrief', json={
            'payload': {'results': {'engine': 'local-network'}},
        })
        assert response.status_code == 200
        assert response.json()['source'] == 'fallback'
        assert response.json()['result']['verdict']


def test_sumo_missing_configuration_is_actionable(monkeypatch):
    monkeypatch.delenv('DATABASE_URL', raising=False)
    with TestClient(app) as client:
        response = client.post('/api/simulation', json={})
        assert response.status_code == 503
        assert 'DATABASE_URL' in response.json()['detail']


def test_sumo_route_preserves_contract_and_validation(monkeypatch):
    import simulation.frontend_contract as contract
    monkeypatch.setenv('DATABASE_URL', 'postgresql://test-only')
    seen = []

    def simulate(payload):
        seen.append(payload)
        if payload.get('unsupported'):
            return {'error': {'message': 'Unsupported intervention'}}
        return {'contract_version': 1, 'engine': 'sumo-traci'}

    monkeypatch.setattr(contract, 'simulate_frontend_scenario', simulate)
    with TestClient(app) as client:
        assert client.post('/api/simulation', json={'seed': 42}).json()['engine'] == 'sumo-traci'
        assert seen[0]['seed'] == 42
        assert client.post('/api/simulation', json={'unsupported': True}).status_code == 422


def test_spoken_reply_returns_audio_and_keeps_keys_server_side(monkeypatch):
    import voice.app.main as module
    from dataclasses import replace
    monkeypatch.setattr(module, 'settings', replace(module.settings, api_key='test-secret', text_only=False))
    with TestClient(app) as client:
        async def speak(text, voice_id=None):
            assert text == 'Simulation complete.'
            return b'ID3-test-audio'

        monkeypatch.setattr(voice.state.eleven, 'text_to_speech', speak)
        response = client.post('/api/voice/voice/speak', json={'text': 'Simulation complete.'})
        assert response.status_code == 200
        assert response.content == b'ID3-test-audio'
        assert 'audio/' in response.headers['content-type']
        assert 'test-secret' not in str(response.headers)


def test_provider_connection_failure_preserves_text_and_fallback(monkeypatch):
    import httpx
    import voice.app.main as voice_module
    import gemini.app.main as gemini_module
    from dataclasses import replace
    monkeypatch.setattr(voice_module, 'settings', replace(voice_module.settings, api_key='test', text_only=False))
    monkeypatch.setattr(gemini_module, 'settings', replace(gemini_module.settings, api_key='test', offline=False))

    async def disconnected(*args, **kwargs):
        raise httpx.ConnectError('Provider unreachable')

    with TestClient(app) as client:
        monkeypatch.setattr(voice.state.eleven, 'text_to_speech', disconnected)
        monkeypatch.setattr(gemini.state.gemini, 'generate_json', disconnected)
        response = client.post('/api/voice/voice/ask', json={
            'question': 'How much budget is left?', 'speak': True,
            'context': {'budget': {'total': 80000, 'spent': 20000}},
        })
        assert response.status_code == 200
        assert '60,000' in response.json()['text']
        assert response.json()['audio_error'] == 'Provider unreachable'
        response = client.post('/api/gemini/generate/simulation_debrief', json={'payload': {}})
        assert response.status_code == 200
        assert response.json()['source'] == 'fallback'
