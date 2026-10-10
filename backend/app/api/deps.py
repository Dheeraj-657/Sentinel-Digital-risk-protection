"""FastAPI dependency wiring. All collaborators live on app.state, built once
in the lifespan; tests override app.state or the dependency directly."""
from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import Header, Request
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import AppError, ErrorCode
from app.core.logging import get_correlation_id


def get_settings_dep(request: Request) -> Settings:
    return request.app.state.settings


def get_db(request: Request):
    """Request-scoped session. Commits on success, rolls back on error —
    routes that must commit before side effects (queue enqueue) commit
    explicitly and early."""
    session: Session = request.app.state.session_factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_tenant(
    x_tenant_id: Annotated[str | None, Header(alias="X-Tenant-ID")] = None,
) -> uuid.UUID:
    """Tenant context. Until real auth exists, tenancy arrives via X-Tenant-ID;
    it is NEVER taken from the request body (anti-spoofing)."""
    if not x_tenant_id:
        raise AppError(
            ErrorCode.TENANT_REQUIRED,
            "X-Tenant-ID header is required.",
            http_status=400,
        )
    try:
        return uuid.UUID(x_tenant_id)
    except ValueError as exc:
        raise AppError(
            ErrorCode.VALIDATION_ERROR,
            "X-Tenant-ID must be a valid UUID.",
            http_status=400,
            details={"header": "X-Tenant-ID"},
        ) from exc


def get_idempotency_key(
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> str | None:
    return idempotency_key


def get_correlation_id_dep() -> str:
    return get_correlation_id()
