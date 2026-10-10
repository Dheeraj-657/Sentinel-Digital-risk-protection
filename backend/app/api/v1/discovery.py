"""Discovery job endpoints."""
from __future__ import annotations

import asyncio
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_settings_dep, get_tenant
from app.core.config import Settings
from app.core.errors import AppError, ErrorCode
from app.core.logging import get_correlation_id
from app.domain.enums import DiscoveryJobStatus
from app.schemas.discovery import (
    DiscoveryCreateRequest,
    DiscoveryJobListItem,
    DiscoveryJobListResponse,
    DiscoveryJobResponse,
)
from app.services.discovery import DiscoveryJobService

router = APIRouter(prefix="/discovery", tags=["discovery"])


@router.post("", response_model=DiscoveryJobResponse, status_code=202)
def create_discovery(
    body: DiscoveryCreateRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_tenant),
    settings: Settings = Depends(get_settings_dep),
) -> DiscoveryJobResponse:
    job = DiscoveryJobService(db).create(tenant_id, body.brand_id)
    # Commit BEFORE enqueue: workers use their own session and must see the job.
    db.commit()

    queue = request.app.state.discovery_queue
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
        job = DiscoveryJobService(db).get(tenant_id, job.id)
        response.status_code = 200

    return DiscoveryJobResponse.model_validate(job)


@router.get("", response_model=DiscoveryJobListResponse)
def list_discovery_jobs(
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_tenant),
    status: DiscoveryJobStatus | None = Query(default=None),
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> DiscoveryJobListResponse:
    jobs, total = DiscoveryJobService(db).list_for_tenant(
        tenant_id, limit=limit, offset=offset, status=status
    )
    return DiscoveryJobListResponse(
        items=[
            DiscoveryJobListItem(
                job_id=j.id,
                status=j.status,
                brand_id=j.brand_id,
                duplicate_count=j.duplicate_count,
                candidate_count=j.candidate_count,
                created_at=j.created_at,
                completed_at=j.completed_at,
                error_code=j.error_code,
            )
            for j in jobs
        ],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/{job_id}", response_model=DiscoveryJobResponse)
def get_discovery(
    job_id: uuid.UUID,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_tenant),
) -> DiscoveryJobResponse:
    job = DiscoveryJobService(db).get(tenant_id, job_id)
    if job is None:
        raise AppError(
            ErrorCode.NOT_FOUND,
            f"Discovery job '{job_id}' was not found.",
            http_status=404,
            details={"job_id": str(job_id)},
        )
    return DiscoveryJobResponse.model_validate(job)
