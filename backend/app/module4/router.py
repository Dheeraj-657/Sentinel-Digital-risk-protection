"""Module 4 routes — `/api/v1/investigation/*`.

Tenant isolation reuses Module 2's `get_tenant` dependency, and every record
is fetched through Module 2's tenant-scoped services, so the analyst can only
ever see the caller's own tenant.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_tenant
from app.core.logging import audit
from app.module4.context import ContextBuilder
from app.module4.llm import GroqClient, LLMClient
from app.module4.schemas import AnalystRequest, AnalystResponse, AnalystStatusResponse
from app.module4.service import AnalystService
from app.module4.settings import Module4Settings

router = APIRouter(prefix="/investigation", tags=["module4-investigation"])

_UNSET = object()


def _settings(request: Request) -> Module4Settings:
    settings = getattr(request.app.state, "module4_settings", None)
    if settings is None:
        settings = Module4Settings()
        request.app.state.module4_settings = settings
    return settings


def _llm(request: Request) -> LLMClient | None:
    """Tests may inject `app.state.module4_llm` (a fake, or None to force the
    template path). Otherwise a Groq client is built when a key is set."""
    injected = getattr(request.app.state, "module4_llm", _UNSET)
    if injected is not _UNSET:
        return injected  # type: ignore[return-value]
    settings = _settings(request)
    return GroqClient(settings) if settings.llm_configured else None


@router.get("/analyst/status", response_model=AnalystStatusResponse)
def analyst_status(request: Request) -> AnalystStatusResponse:
    """Configuration only — never the key itself."""
    settings = _settings(request)
    injected = getattr(request.app.state, "module4_llm", _UNSET)
    configured = (injected is not _UNSET and injected is not None) or (
        injected is _UNSET and settings.llm_configured
    )
    return AnalystStatusResponse(
        llm_provider="groq",
        llm_configured=bool(configured),
        model=settings.groq_model,
        grounding="citations validated against stored evidence; numbers, levels, scores and action claims checked",
    )


@router.post("/analyst", response_model=AnalystResponse)
def ask_analyst(
    body: AnalystRequest,
    request: Request,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_tenant),
) -> AnalystResponse:
    with audit(
        request.app.state.logger,
        "module4.analyst_question",
        threat_id=str(body.threat_id) if body.threat_id else None,
        entity_id=str(body.entity_id) if body.entity_id else None,
    ):
        builder = ContextBuilder(db, tenant_id, request.app.state)
        return AnalystService(builder, _llm(request)).answer(body)
