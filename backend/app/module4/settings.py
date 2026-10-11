"""Module 4 analyst LLM configuration.

Reuses the SAME variable names Module 1 (Sentinel DRP) uses for its Groq
assessments — GROQ_API_KEY / GROQ_MODEL / GROQ_BASE_URL — so one key
configures both. Credentials stay server-side; nothing here is ever returned
to the client.
"""
from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Module4Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    groq_api_key: str | None = None
    groq_model: str = "openai/gpt-oss-120b"
    groq_base_url: str = "https://api.groq.com/openai/v1"
    groq_timeout_seconds: float = 20.0

    @property
    def llm_configured(self) -> bool:
        return bool(self.groq_api_key and self.groq_api_key.strip())
