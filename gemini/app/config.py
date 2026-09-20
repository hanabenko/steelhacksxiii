"""Configuration loaded from `gemini/.env`, then the repo-root `.env`."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

GEMINI_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = GEMINI_DIR.parent

PLACEHOLDER_KEYS = {"", "replace_me", "your_api_key_here", "AIza_replace_me"}


def _load_env_files() -> None:
    """Root `.env` first, then `gemini/.env` overrides. Real env vars win."""
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    load_dotenv(REPO_ROOT / ".env", override=False)
    load_dotenv(GEMINI_DIR / ".env", override=False)


def _flag(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    return default if raw is None else raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    api_key: str | None
    model: str
    temperature: float
    max_output_tokens: int
    timeout_seconds: float
    host: str
    port: int
    allowed_origins: tuple[str, ...]
    offline: bool

    @property
    def has_key(self) -> bool:
        return bool(self.api_key) and self.api_key not in PLACEHOLDER_KEYS

    @property
    def generation_enabled(self) -> bool:
        """Live generation needs a real key and offline mode switched off."""
        return self.has_key and not self.offline


def load_settings() -> Settings:
    _load_env_files()
    origins = os.getenv(
        "GEMINI_ALLOWED_ORIGINS", "http://127.0.0.1:5173,http://localhost:5173"
    )
    return Settings(
        api_key=(os.getenv("GEMINI_API_KEY") or "").strip() or None,
        model=os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip(),
        temperature=float(os.getenv("GEMINI_TEMPERATURE", "0.35")),
        max_output_tokens=int(os.getenv("GEMINI_MAX_OUTPUT_TOKENS", "1024")),
        timeout_seconds=float(os.getenv("GEMINI_TIMEOUT_SECONDS", "30")),
        host=os.getenv("GEMINI_HOST", "127.0.0.1"),
        port=int(os.getenv("GEMINI_PORT", "8091")),
        allowed_origins=tuple(o.strip() for o in origins.split(",") if o.strip()),
        offline=_flag("GEMINI_OFFLINE"),
    )
