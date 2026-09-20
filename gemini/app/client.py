"""Thin Gemini REST client.

Generic on purpose: it knows about models, schemas and HTTP, and nothing about
Interlock. What to generate lives entirely in `generation.py`.
"""

from __future__ import annotations

import json
from typing import Any

import httpx

from .config import Settings

API_BASE = "https://generativelanguage.googleapis.com/v1beta"


class GeminiError(RuntimeError):
    def __init__(self, message: str, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


class GeminiClient:
    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None) -> None:
        self._settings = settings
        self._client = client or httpx.AsyncClient(
            timeout=httpx.Timeout(settings.timeout_seconds, connect=10.0)
        )
        self._owns_client = client is None

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    @property
    def _headers(self) -> dict[str, str]:
        if not self._settings.has_key:
            raise GeminiError(
                "GEMINI_API_KEY is missing or still the placeholder. "
                "Set it in gemini/.env or the repo-root .env."
            )
        return {
            "x-goog-api-key": self._settings.api_key or "",
            "Content-Type": "application/json",
        }

    @staticmethod
    def _raise_for_status(response: httpx.Response) -> None:
        if response.is_success:
            return
        detail = response.text[:400].strip() or response.reason_phrase
        if response.status_code in (401, 403):
            detail = "Google rejected the API key or it lacks access to this model."
        elif response.status_code == 429:
            detail = "Gemini rate limit or quota reached."
        elif response.status_code == 404:
            detail = f"Model not found: {detail}"
        raise GeminiError(f"Gemini request failed: {detail}", response.status_code)

    async def generate_json(
        self,
        prompt: str,
        schema: dict[str, Any],
        system_instruction: str = "",
        temperature: float | None = None,
        model: str | None = None,
    ) -> dict[str, Any]:
        """Run one structured-output generation and return parsed JSON."""
        settings = self._settings
        body: dict[str, Any] = {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {
                "responseMimeType": "application/json",
                "responseSchema": schema,
                "temperature": settings.temperature if temperature is None else temperature,
                "maxOutputTokens": settings.max_output_tokens,
            },
        }
        if system_instruction:
            body["systemInstruction"] = {"parts": [{"text": system_instruction}]}

        response = await self._client.post(
            f"{API_BASE}/models/{model or settings.model}:generateContent",
            headers=self._headers,
            json=body,
        )
        self._raise_for_status(response)
        return self._extract(response.json())

    @staticmethod
    def _extract(payload: dict[str, Any]) -> dict[str, Any]:
        candidates = payload.get("candidates") or []
        if not candidates:
            blocked = (payload.get("promptFeedback") or {}).get("blockReason")
            raise GeminiError(f"Gemini returned no candidates{f' ({blocked})' if blocked else ''}.")

        candidate = candidates[0]
        if candidate.get("finishReason") == "MAX_TOKENS":
            raise GeminiError("Gemini hit the output token limit; raise GEMINI_MAX_OUTPUT_TOKENS.")

        parts = (candidate.get("content") or {}).get("parts") or []
        text = "".join(part.get("text", "") for part in parts).strip()
        if not text:
            raise GeminiError("Gemini returned an empty response.")
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError as exc:
            raise GeminiError(f"Gemini returned invalid JSON: {exc}") from exc
        if not isinstance(parsed, dict):
            raise GeminiError("Gemini returned JSON that was not an object.")
        return parsed

    async def list_models(self) -> list[str]:
        response = await self._client.get(f"{API_BASE}/models", headers=self._headers)
        self._raise_for_status(response)
        return [
            model.get("name", "").removeprefix("models/")
            for model in response.json().get("models", [])
            if "generateContent" in (model.get("supportedGenerationMethods") or [])
        ]
