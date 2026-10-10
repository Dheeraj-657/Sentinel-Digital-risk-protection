"""Groq (OpenAI-compatible) chat client for the analyst — server-side only.

Mirrors Module 1's Groq usage: same env vars, JSON output mode, low
temperature, bounded retries that honour `retry-after`, and a process-wide
concurrency cap. The API key never leaves this process.
"""
from __future__ import annotations

import json
import threading
import time
from typing import Protocol

import httpx

from app.core.logging import get_logger
from app.module4.settings import Module4Settings

logger = get_logger("app.module4.llm")

MAX_ATTEMPTS = 3
_GATE = threading.BoundedSemaphore(3)


class LLMError(Exception):
    def __init__(self, message: str, retryable: bool = False, retry_after: float = 0.0) -> None:
        super().__init__(message)
        self.retryable = retryable
        self.retry_after = retry_after


class LLMClient(Protocol):
    model: str

    def complete_json(self, system: str, messages: list[dict[str, str]]) -> dict: ...


class GroqClient:
    def __init__(self, settings: Module4Settings) -> None:
        self._key = (settings.groq_api_key or "").strip()
        self._url = settings.groq_base_url.rstrip("/") + "/chat/completions"
        self._timeout = settings.groq_timeout_seconds
        self.model = settings.groq_model

    def _call(self, system: str, messages: list[dict[str, str]]) -> dict:
        body: dict = {
            "model": self.model,
            "temperature": 0.2,
            "max_completion_tokens": 1200,
            "response_format": {"type": "json_object"},
            "messages": [{"role": "system", "content": system}, *messages],
        }
        if self.model.startswith("openai/gpt-oss"):
            body["reasoning_effort"] = "low"
            body["include_reasoning"] = False
        try:
            response = httpx.post(
                self._url,
                json=body,
                headers={"Authorization": f"Bearer {self._key}"},
                timeout=self._timeout,
            )
        except httpx.TimeoutException as exc:
            raise LLMError("the AI provider timed out", retryable=True) from exc
        except httpx.HTTPError as exc:
            raise LLMError("the AI provider could not be reached", retryable=True) from exc

        if response.status_code == 429:
            try:
                wait = float(response.headers.get("retry-after", "2"))
            except ValueError:
                wait = 2.0
            raise LLMError("the AI provider rate limit was reached", retryable=True, retry_after=wait)
        if response.status_code >= 500:
            raise LLMError(f"the AI provider returned {response.status_code}", retryable=True)
        if response.status_code == 401:
            raise LLMError("the AI provider rejected the API key")
        if response.status_code != 200:
            raise LLMError(f"the AI provider returned {response.status_code}")

        try:
            content = response.json()["choices"][0]["message"]["content"]
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            raise LLMError("the AI provider returned an unexpected payload", retryable=True) from exc
        if not content:
            raise LLMError("the AI provider returned an empty answer", retryable=True)
        try:
            return json.loads(content)
        except ValueError:
            start, end = content.find("{"), content.rfind("}")
            if start != -1 and end > start:
                try:
                    return json.loads(content[start : end + 1])
                except ValueError:
                    pass
            raise LLMError("the AI provider returned non-JSON output", retryable=True)

    def complete_json(self, system: str, messages: list[dict[str, str]]) -> dict:
        last: LLMError | None = None
        for attempt in range(1, MAX_ATTEMPTS + 1):
            with _GATE:
                try:
                    return self._call(system, messages)
                except LLMError as exc:
                    last = exc
            if not last.retryable or attempt == MAX_ATTEMPTS:
                break
            time.sleep(min(last.retry_after or 0.8 * attempt, 5.0))
        logger.warning("module4_llm_failed", extra={"context": {"reason": str(last)}})
        raise last or LLMError("the AI provider failed")
