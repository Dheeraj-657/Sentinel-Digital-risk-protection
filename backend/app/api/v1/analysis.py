"""Analysis job endpoints."""
from __future__ import annotations

import asyncio
import uuid

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_idempotency_key, get_settings_dep, get_tenant
from app.core.config import Settings
from app.core.errors import AppError, ErrorCode
from app.core.logging import get_correlation_id
from app.schemas.analysis import AnalysisCreateRequest, AnalysisJobResponse
from app.services.idempotency import IdempotencyService, fingerprint_request
from app.services.jobs import JobService

router = APIRouter(prefix="/analysis", tags=["analysis"])


@router.post("", response_model=AnalysisJobResponse, status_code=202)
def create_analysis(
    body: AnalysisCreateRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_tenant),
    idempotency_key: str | None = Depends(get_idempotency_key),
    settings: Settings = Depends(get_settings_dep),
) -> AnalysisJobResponse:
    payload = body.model_dump(mode="json")
    job, created = IdempotencyService(
        db, settings.idempotency_retention_hours
    ).submit(
        tenant_id=tenant_id,
        brand_id=body.brand_id,
        entity_id=body.entity_id,
        idempotency_key=idempotency_key,
        fingerprint=fingerprint_request(payload),
    )
    # Commit BEFORE enqueue: workers use their own session and must see the job.
    db.commit()

    if idempotency_key:
        response.headers["Idempotency-Key"] = idempotency_key

    queue = request.app.state.queue
    # Sync def routes run on a worker thread; scheduling must go through the
    # running loop captured at startup.
    future = asyncio.run_coroutine_threadsafe(
        queue.enqueue(job.id, get_correlation_id()),
        request.app.state.loop,
    )

    if settings.worker_mode.value == "sync":
        # Sync queue executes inline; wait so the response reflects the
        # final state.
        future.result(timeout=300)
        db.expire_all()
        job = JobService(db).get(tenant_id, job.id)
        response.status_code = 200
    elif not created:
        response.status_code = 200

    return AnalysisJobResponse.model_validate(job)


@router.get("/{job_id}", response_model=AnalysisJobResponse)
def get_analysis(
    job_id: uuid.UUID,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_tenant),
) -> AnalysisJobResponse:
    job = JobService(db).get(tenant_id, job_id)
    if job is None:
        raise AppError(
            ErrorCode.NOT_FOUND,
            f"Analysis job '{job_id}' was not found.",
            http_status=404,
            details={"job_id": str(job_id)},
        )
    return AnalysisJobResponse.model_validate(job)
