"""Shared response/error schemas (API envelope)."""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from app.core.errors import ErrorCode


class ErrorEnvelope(BaseModel):
    """Uniform error body. Never exposes stack traces."""

    error_code: ErrorCode
    message: str = Field(description="Human-readable, safe-to-display message")
    details: dict | None = Field(default=None, description="Structured, non-sensitive context")
    correlation_id: str = Field(description="Correlate with server logs for diagnosis")


class HealthResponse(BaseModel):
    model_config = ConfigDict()

    status: str = "ok"
    service: str = "trustgraph-module-2"
    version: str


class ReadyResponse(BaseModel):
    status: str
    checks: dict[str, str]
