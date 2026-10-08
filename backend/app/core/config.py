from __future__ import annotations

from enum import Enum

from pydantic_settings import BaseSettings, SettingsConfigDict


class WorkerMode(str, Enum):
    """Analysis job execution strategy.

    in_process: asyncio worker consumes a job queue in the API process.
    sync: pipeline executes inline within the request (deterministic tests).
    """

    IN_PROCESS = "in_process"
    SYNC = "sync"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="TRUSTGRAPH_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "trustgraph-module2"
    environment: str = "development"
    log_level: str = "INFO"
    api_v1_prefix: str = "/api/v1"

    database_url: str = "sqlite:///./trustgraph_module2.db"

    # Module 1 / Module 3 endpoints. Unset => MOCK adapters are used and
    # every mock response is labeled as such (never presented as real intel).
    module1_base_url: str | None = None
    module3_base_url: str | None = None
    integration_http_timeout_seconds: float = 10.0

    worker_mode: WorkerMode = WorkerMode.IN_PROCESS
    worker_concurrency: int = 2

    idempotency_retention_hours: int = 24

    # ML model selection (registry keys, see app/ml/registry.py)
    text_model: str = "char_ngram_tfidf"
    visual_model: str = "phash_hamming"
    identity_model: str = "token_similarity"

    max_request_body_bytes: int = 65_536

    @property
    def using_mock_integrations(self) -> bool:
        return self.module1_base_url is None or self.module3_base_url is None


def get_settings() -> Settings:
    from functools import lru_cache

    @lru_cache
    def _load() -> Settings:
        return Settings()

    return _load()
