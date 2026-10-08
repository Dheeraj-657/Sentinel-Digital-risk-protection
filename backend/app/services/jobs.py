"""Analysis job lifecycle operations (create, fetch)."""
from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.enums import JobStatus
from app.models.analysis import AnalysisJob


class JobService:
    def __init__(self, session: Session) -> None:
        self._session = session

    def create(self, *, tenant_id: uuid.UUID, brand_id: uuid.UUID, entity_id: uuid.UUID) -> AnalysisJob:
        job = AnalysisJob(
            tenant_id=tenant_id,
            brand_id=brand_id,
            entity_id=entity_id,
            status=JobStatus.QUEUED,
        )
        self._session.add(job)
        self._session.flush()
        return job

    def get(self, tenant_id: uuid.UUID, job_id: uuid.UUID) -> AnalysisJob | None:
        stmt = select(AnalysisJob).where(
            AnalysisJob.tenant_id == tenant_id,
            AnalysisJob.id == job_id,
        )
        return self._session.scalars(stmt).first()

    def list_for_tenant(
        self,
        tenant_id: uuid.UUID,
        *,
        limit: int,
        offset: int,
        status: JobStatus | None = None,
    ) -> tuple[list[AnalysisJob], int]:
        conditions = [AnalysisJob.tenant_id == tenant_id]
        if status is not None:
            conditions.append(AnalysisJob.status == status)
        stmt = (
            select(AnalysisJob)
            .where(*conditions)
            .order_by(AnalysisJob.created_at.desc(), AnalysisJob.id)
            .limit(limit)
            .offset(offset)
        )
        items = list(self._session.scalars(stmt).all())
        from sqlalchemy import func

        total = self._session.scalar(
            select(func.count()).select_from(AnalysisJob).where(*conditions)
        )
        return items, int(total or 0)
