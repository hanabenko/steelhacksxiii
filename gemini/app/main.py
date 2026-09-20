"""Interlock generative service.

Generic by design: every route is driven by the catalog in `generation.py`.
This file names no individual generation task, so adding one never requires
touching the API.

    uvicorn app.main:app --reload --port 8091     # from the `gemini/` directory
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any
import httpx

from fastapi import Body, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .client import GeminiClient, GeminiError
from .config import load_settings
from .generation import catalog, get_task, unverified_numbers

settings = load_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.gemini = GeminiClient(settings)
    try:
        yield
    finally:
        await app.state.gemini.aclose()


app = FastAPI(
    title="Interlock generative layer",
    description="Gemini-backed generation, driven entirely by the task catalog.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.allowed_origins),
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


class GenerateRequest(BaseModel):
    payload: dict[str, Any] = Field(
        default_factory=dict,
        description="Facts for this task. The model may state no other numbers.",
    )
    allow_fallback: bool = Field(
        default=True,
        description="Return the deterministic fallback if Gemini fails.",
    )
    model: str | None = Field(default=None, description="Override the configured model.")


class GenerateResponse(BaseModel):
    task: str
    result: dict[str, Any]
    source: str = Field(description="`gemini` or `fallback`.")
    model: str | None = None
    unverified_numbers: list[str] = Field(
        default_factory=list,
        description="Figures in the output absent from the input. Empty is good.",
    )
    error: str | None = None


@app.get("/health")
async def health() -> dict[str, object]:
    return {
        "status": "ok",
        "generation_enabled": settings.generation_enabled,
        "api_key_configured": settings.has_key,
        "offline": settings.offline,
        "model": settings.model,
        "tasks": len(catalog()),
    }


@app.get("/generate")
async def list_tasks() -> dict[str, list[dict[str, str]]]:
    """Every generation Interlock needs, straight from the catalog."""
    return {"tasks": catalog()}


@app.get("/generate/{task_id}/schema")
async def task_schema(task_id: str) -> dict[str, Any]:
    task = get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail=f"Unknown task: {task_id}")
    return {
        **task.describe(),
        "schema": task.schema,
        "temperature": task.temperature if task.temperature is not None else settings.temperature,
    }


@app.post("/generate/{task_id}", response_model=GenerateResponse)
async def generate(task_id: str, request: GenerateRequest = Body(...)) -> GenerateResponse:
    """Run one catalog task.

    Never fails the caller by default: if Gemini is unavailable, misconfigured,
    or over quota, the task's deterministic fallback is returned with `source`
    set to `fallback` and the reason in `error`. A demo keeps working.
    """
    task = get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail=f"Unknown task: {task_id}")

    def as_fallback(reason: str | None) -> GenerateResponse:
        if reason and not request.allow_fallback:
            raise HTTPException(status_code=503, detail=reason)
        return GenerateResponse(
            task=task_id, result=task.fallback(request.payload), source="fallback", error=reason
        )

    if not settings.generation_enabled:
        return as_fallback(
            "Generation disabled: set GEMINI_API_KEY (and GEMINI_OFFLINE=0)."
            if not settings.has_key
            else "GEMINI_OFFLINE is set."
        )

    try:
        result = await app.state.gemini.generate_json(
            prompt=task.build_prompt(request.payload),
            schema=task.schema,
            system_instruction=task.system_instruction,
            temperature=task.temperature,
            model=request.model,
        )
    except (GeminiError, httpx.HTTPError) as exc:
        return as_fallback(str(exc))

    return GenerateResponse(
        task=task_id,
        result=result,
        source="gemini",
        model=request.model or settings.model,
        unverified_numbers=unverified_numbers(result, request.payload),
    )


@app.get("/models")
async def models() -> dict[str, object]:
    if not settings.has_key:
        raise HTTPException(status_code=503, detail="GEMINI_API_KEY is not configured.")
    try:
        return {"models": await app.state.gemini.list_models()}
    except (GeminiError, httpx.HTTPError) as exc:
        raise HTTPException(status_code=getattr(exc, 'status_code', None) or 502, detail=str(exc)) from exc
