"""Interlock voice service.

Runs standalone on its own port, separate from the simulation API. The Three.js
frontend posts the scene context it already holds; this service answers only
from that context and optionally returns spoken audio.

    uvicorn app.main:app --reload --port 8090      # from the `voice/` directory
"""

from __future__ import annotations

import base64
from contextlib import asynccontextmanager
from pathlib import Path
import httpx

from fastapi import Body, FastAPI, File, Form, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .config import load_settings
from .context import SceneContext
from .elevenlabs import ElevenLabsClient, ElevenLabsError
from .intents import Intent, answer as answer_question
from .speech import speakable

settings = load_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.eleven = ElevenLabsClient(settings)
    try:
        yield
    finally:
        await app.state.eleven.aclose()


app = FastAPI(
    title="Interlock voice interface",
    description="Grounded, map-scoped voice questions and spoken narration.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.allowed_origins),
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


# --- Request / response models ---------------------------------------------


class AskRequest(BaseModel):
    question: str = Field(..., description="What the player asked, as text.")
    context: SceneContext = Field(
        default_factory=SceneContext,
        description="Current map and game state. The answer uses nothing else.",
    )
    speak: bool = Field(default=True, description="Also synthesize spoken audio.")
    voice_id: str | None = None


class AskResponse(BaseModel):
    intent: Intent
    text: str
    grounded: bool
    missing: list[str] = Field(default_factory=list)
    audio_base64: str | None = None
    audio_content_type: str | None = None
    audio_error: str | None = None


class SpeakRequest(BaseModel):
    text: str = Field(..., description="Street name, warning, or summary to read aloud.")
    voice_id: str | None = None
    normalize: bool = Field(
        default=True,
        description="Expand $, %, mph, TTC and similar so they are read correctly.",
    )


def _audio_content_type() -> str:
    fmt = settings.output_format
    if fmt.startswith("mp3"):
        return "audio/mpeg"
    if fmt.startswith("opus"):
        return "audio/ogg"
    if fmt.startswith("ulaw") or fmt.startswith("alaw"):
        return "audio/basic"
    return "audio/wav" if fmt.startswith("pcm") else "application/octet-stream"


# --- Routes ----------------------------------------------------------------


WEB_DIR = Path(__file__).resolve().parents[1] / "web"
if WEB_DIR.is_dir():
    # Serving the harness from this origin keeps local testing free of CORS setup.
    app.mount("/demo", StaticFiles(directory=WEB_DIR, html=True), name="demo")


@app.get("/health")
async def health() -> dict[str, object]:
    """Report whether spoken audio is actually available."""
    return {
        "status": "ok",
        "audio_enabled": settings.audio_enabled,
        "api_key_configured": settings.has_key,
        "text_only": settings.text_only,
        "voice_id": settings.voice_id,
        "tts_model": settings.tts_model,
        "stt_model": settings.stt_model,
    }


@app.get("/voice/intents")
async def intents() -> dict[str, list[str]]:
    """The closed set of things the voice will answer. Useful for UI hints."""
    return {"intents": [intent.value for intent in Intent]}


@app.post("/voice/ask", response_model=AskResponse)
async def ask(request: AskRequest = Body(...)) -> AskResponse:
    """Answer a map question from the supplied context, optionally aloud.

    Audio failures never hide the answer: the text always comes back, with the
    synthesis problem reported in `audio_error`.
    """
    result = answer_question(request.question, request.context)

    audio_base64: str | None = None
    audio_error: str | None = None
    content_type: str | None = None

    if request.speak:
        if not settings.audio_enabled:
            audio_error = (
                "Audio disabled: set ELEVENLABS_API_KEY (and VOICE_TEXT_ONLY=0)."
            )
        else:
            try:
                audio = await app.state.eleven.text_to_speech(result.text, request.voice_id)
                audio_base64 = base64.b64encode(audio).decode("ascii")
                content_type = _audio_content_type()
            except (ElevenLabsError, httpx.HTTPError) as exc:
                audio_error = str(exc)

    return AskResponse(
        intent=result.intent,
        text=result.text,
        grounded=result.grounded,
        missing=list(result.missing),
        audio_base64=audio_base64,
        audio_content_type=content_type,
        audio_error=audio_error,
    )


@app.post(
    "/voice/speak",
    responses={200: {"content": {"audio/mpeg": {}}, "description": "Synthesized speech"}},
)
async def speak(request: SpeakRequest = Body(...)) -> Response:
    """Read arbitrary UI text aloud: a street name, a warning, a summary."""
    if not settings.audio_enabled:
        raise HTTPException(
            status_code=503,
            detail="Audio disabled: set ELEVENLABS_API_KEY (and VOICE_TEXT_ONLY=0).",
        )
    text = speakable(request.text) if request.normalize else request.text
    try:
        audio = await app.state.eleven.text_to_speech(text, request.voice_id)
    except (ElevenLabsError, httpx.HTTPError) as exc:
        raise HTTPException(status_code=getattr(exc, 'status_code', None) or 502, detail=str(exc)) from exc
    return Response(content=audio, media_type=_audio_content_type())


@app.post("/voice/transcribe")
async def transcribe(file: UploadFile = File(...)) -> dict[str, str]:
    """Turn a recorded microphone clip into question text."""
    if not settings.has_key:
        raise HTTPException(status_code=503, detail="ELEVENLABS_API_KEY is not configured.")
    audio = await file.read()
    try:
        text = await app.state.eleven.speech_to_text(
            audio, file.filename or "question.webm", file.content_type or "audio/webm"
        )
    except (ElevenLabsError, httpx.HTTPError) as exc:
        raise HTTPException(status_code=getattr(exc, 'status_code', None) or 502, detail=str(exc)) from exc
    return {"text": text}


@app.post("/voice/converse", response_model=AskResponse)
async def converse(
    file: UploadFile = File(..., description="Recorded question audio."),
    context: str = Form("{}", description="SceneContext as a JSON string."),
    speak_reply: bool = Form(True),
) -> AskResponse:
    """One round trip: microphone in, grounded spoken answer out."""
    transcript = (await transcribe(file))["text"]
    try:
        scene = SceneContext.model_validate_json(context)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"Invalid context JSON: {exc}") from exc
    return await ask(AskRequest(question=transcript, context=scene, speak=speak_reply))


@app.get("/voice/voices")
async def voices() -> dict[str, object]:
    """List the account's voices so a real ID can replace the default."""
    if not settings.has_key:
        raise HTTPException(status_code=503, detail="ELEVENLABS_API_KEY is not configured.")
    try:
        return {"voices": await app.state.eleven.list_voices()}
    except (ElevenLabsError, httpx.HTTPError) as exc:
        raise HTTPException(status_code=getattr(exc, 'status_code', None) or 502, detail=str(exc)) from exc
