"""Configuration loaded from `voice/.env`, then the repo-root `.env`."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

VOICE_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = VOICE_DIR.parent

PLACEHOLDER_KEYS = {"", "sk_replace_me", "your_api_key_here", "replace_me"}


def _load_env_files() -> None:
    """Load the root `.env` first, then let `voice/.env` override it.

    Existing process environment always wins, so `ELEVENLABS_API_KEY=... uv run`
    behaves as expected and secrets can stay out of files entirely.
    """
    try:
        from dotenv import load_dotenv
    except ImportError:  # dotenv is optional; env vars alone are enough
        return
    load_dotenv(REPO_ROOT / ".env", override=False)
    load_dotenv(VOICE_DIR / ".env", override=False)


def _flag(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    api_key: str | None
    voice_id: str
    tts_model: str
    stt_model: str
    output_format: str
    stability: float
    similarity_boost: float
    speed: float
    host: str
    port: int
    allowed_origins: tuple[str, ...]
    text_only: bool

    @property
    def has_key(self) -> bool:
        return bool(self.api_key) and self.api_key not in PLACEHOLDER_KEYS

    @property
    def audio_enabled(self) -> bool:
        """Audio needs a real key and text-only mode switched off."""
        return self.has_key and not self.text_only


def load_settings() -> Settings:
    _load_env_files()
    origins = os.getenv(
        "VOICE_ALLOWED_ORIGINS", "http://127.0.0.1:5173,http://localhost:5173"
    )
    return Settings(
        api_key=(os.getenv("ELEVENLABS_API_KEY") or "").strip() or None,
        voice_id=os.getenv("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM").strip(),
        tts_model=os.getenv("ELEVENLABS_TTS_MODEL", "eleven_flash_v2_5").strip(),
        stt_model=os.getenv("ELEVENLABS_STT_MODEL", "scribe_v1").strip(),
        output_format=os.getenv("ELEVENLABS_OUTPUT_FORMAT", "mp3_44100_128").strip(),
        stability=float(os.getenv("ELEVENLABS_STABILITY", "0.55")),
        similarity_boost=float(os.getenv("ELEVENLABS_SIMILARITY_BOOST", "0.75")),
        speed=float(os.getenv("ELEVENLABS_SPEED", "1.0")),
        host=os.getenv("VOICE_HOST", "127.0.0.1"),
        port=int(os.getenv("VOICE_PORT", "8090")),
        allowed_origins=tuple(o.strip() for o in origins.split(",") if o.strip()),
        text_only=_flag("VOICE_TEXT_ONLY"),
    )
