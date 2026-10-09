from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="TRUSTGRAPH_M3_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "trustgraph-module3"
    environment: str = "development"
    log_level: str = "INFO"
    api_v1_prefix: str = "/api/v1"

    database_url: str = "sqlite:///./module3.db"


def get_settings() -> Settings:
    from functools import lru_cache

    @lru_cache
    def _load() -> Settings:
        return Settings()

    return _load()
