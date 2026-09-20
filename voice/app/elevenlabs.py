"""Thin, explicit ElevenLabs REST client.

Only the two endpoints this project needs are wrapped: text-to-speech for
reading street names, warnings and simulation summaries aloud, and
speech-to-text for microphone questions. The API key never leaves this
process - the browser talks to our FastAPI service, not to ElevenLabs.
"""

from __future__ import annotations

import httpx

from .config import Settings

API_BASE = "https://api.elevenlabs.io/v1"
DEFAULT_TIMEOUT = httpx.Timeout(30.0, connect=10.0)


class ElevenLabsError(RuntimeError):
    """An ElevenLabs request failed. Carries the upstream status when known."""

    def __init__(self, message: str, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


class ElevenLabsClient:
    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None) -> None:
        self._settings = settings
        self._client = client or httpx.AsyncClient(timeout=DEFAULT_TIMEOUT)
        self._owns_client = client is None

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    @property
    def _headers(self) -> dict[str, str]:
        if not self._settings.has_key:
            raise ElevenLabsError(
                "ELEVENLABS_API_KEY is missing or still the placeholder. "
                "Set it in voice/.env or the repo-root .env."
            )
        return {"xi-api-key": self._settings.api_key or ""}

    @staticmethod
    def _raise_for_status(response: httpx.Response, action: str) -> None:
        if response.is_success:
            return
        detail = response.text[:400].strip() or response.reason_phrase
        if response.status_code == 401:
            detail = "ElevenLabs rejected the API key (401)."
        elif response.status_code == 429:
            detail = "ElevenLabs rate limit or quota reached (429)."
        raise ElevenLabsError(f"{action} failed: {detail}", response.status_code)

    async def text_to_speech(self, text: str, voice_id: str | None = None) -> bytes:
        """Synthesize `text` and return the raw audio bytes."""
        if not text.strip():
            raise ElevenLabsError("Nothing to speak.")
        settings = self._settings
        voice = voice_id or settings.voice_id
        response = await self._client.post(
            f"{API_BASE}/text-to-speech/{voice}",
            headers={**self._headers, "Content-Type": "application/json"},
            params={"output_format": settings.output_format},
            json={
                "text": text,
                "model_id": settings.tts_model,
                "voice_settings": {
                    "stability": settings.stability,
                    "similarity_boost": settings.similarity_boost,
                    "speed": settings.speed,
                },
            },
        )
        self._raise_for_status(response, "Text to speech")
        return response.content

    async def speech_to_text(
        self, audio: bytes, filename: str = "question.webm", content_type: str = "audio/webm"
    ) -> str:
        """Transcribe recorded microphone audio into a question string."""
        if not audio:
            raise ElevenLabsError("No audio was uploaded.")
        response = await self._client.post(
            f"{API_BASE}/speech-to-text",
            headers=self._headers,
            files={"file": (filename, audio, content_type)},
            data={"model_id": self._settings.stt_model},
        )
        self._raise_for_status(response, "Speech to text")
        payload = response.json()
        return (payload.get("text") or "").strip()

    async def list_voices(self) -> list[dict[str, str]]:
        """Return the account's voices, so real IDs can replace the default."""
        response = await self._client.get(f"{API_BASE}/voices", headers=self._headers)
        self._raise_for_status(response, "Listing voices")
        return [
            {
                "voice_id": voice.get("voice_id", ""),
                "name": voice.get("name", ""),
                "category": voice.get("category", ""),
            }
            for voice in response.json().get("voices", [])
        ]
