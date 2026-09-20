"""One origin for Gemini, ElevenLabs and the supported SUMO contract.

Run: .venv/Scripts/python -m uvicorn app_server:app --port 8080
"""
from contextlib import asynccontextmanager
from pathlib import Path
import os
import threading

from fastapi import FastAPI, HTTPException
from starlette.concurrency import run_in_threadpool
from fastapi.staticfiles import StaticFiles
from gemini.app.main import app as gemini, lifespan as gemini_lifespan
from voice.app.main import app as voice, lifespan as voice_lifespan


@asynccontextmanager
async def lifespan(app):
    async with gemini_lifespan(gemini), voice_lifespan(voice):
        yield


app = FastAPI(title="Interlock app", lifespan=lifespan)
app.mount('/api/gemini', gemini)
app.mount('/api/voice', voice)
simulation_lock = threading.Lock()


@app.get('/api/health')
def health():
    return {'status': 'ok'}


@app.post('/api/simulation')
async def simulate(payload: dict):
    if not os.getenv('DATABASE_URL'):
        raise HTTPException(503, 'Set DATABASE_URL and load the baseline traffic data to enable SUMO.')
    if not simulation_lock.acquire(blocking=False):
        raise HTTPException(409, 'A SUMO study is already running. Please wait for it to finish.')
    try:
        from simulation.frontend_contract import simulate_frontend_scenario
        result = await run_in_threadpool(simulate_frontend_scenario, payload)
    except ImportError as exc:
        raise HTTPException(503, 'Install the root simulation dependencies to enable SUMO.') from exc
    except Exception as exc:
        raise HTTPException(503, 'SUMO could not complete. Check database migrations, baseline data, and SUMO installation.') from exc
    finally:
        simulation_lock.release()
    if 'error' in result:
        raise HTTPException(422, result['error'])
    return result


dist = Path(__file__).parent / 'frontend' / 'dist'
if dist.is_dir():
    app.mount('/', StaticFiles(directory=dist, html=True), name='frontend')
