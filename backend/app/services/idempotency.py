"""Idempotent job submission.

Idempotency-Key semantics (per the master contract):
- same key + same request fingerprint → replay the ORIGINAL job (no new job)
- same key + different fingerprint   → DuplicateJobError (409)
- key absent                         → always create a new job

Fingerprints are sha256 over canonical JSON (sorted keys), so semantically
identical bodies with different key order replay correctly. Expired records
(age > idempotency_retention_hours) are replaced by a fresh submission.
"""
from __future__ import annotations

import hashlib
import json
import uuid
from datetime import timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.errors import DuplicateJobError
from app.models.analysis import AnalysisJob
from app.models.base import utcnow
from app.models.idempotency import IdempotencyRecord
from app.services.jobs import JobService


def fingerprint_request(payload: dict) -> str:
    canonical = json.dumps(
        payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


class IdempotencyService:
    def __init__(self, session: Session, retention_hours: int) -> None:
        self._session = session
        self._retention = timedelta(hours=retention_hours)

    def submit(
        self,
        *,
        tenant_id: uuid.UUID,
        brand_id: uuid.UUID,
        entity_id: uuid.UUID,
        idempotency_key: str | None,
        fingerprint: str,
    ) -> tuple[AnalysisJob, bool]:
        """Return (job, created). Commit is left to the caller (the API layer
        owns transaction boundaries)."""
        jobs = JobService(self._session)

        if idempotency_key:
            existing = self._lookup(tenant_id, idempotency_key)
            if existing is not None and existing.expires_at > utcnow():
                if existing.request_fingerprint != fingerprint:
                    raise DuplicateJobError(idempotency_key)
                job = self._session.get(AnalysisJob, existing.job_id)
                if job is not None:
                    return job, False

        job = jobs.create(tenant_id=tenant_id, brand_id=brand_id, entity_id=entity_id)

        if idempotency_key:
            now = utcnow()
            # Replace any expired record for this key (unique per tenant+key).
            self._session.execute(
                delete(IdempotencyRecord).where(
                    IdempotencyRecord.tenant_id == tenant_id,
                    IdempotencyRecord.idempotency_key == idempotency_key,
                )
            )
            self._session.add(
                IdempotencyRecord(
                    tenant_id=tenant_id,
                    idempotency_key=idempotency_key,
                    request_fingerprint=fingerprint,
                    job_id=job.id,
                    created_at=now,
                    expires_at=now + self._retention,
                )
            )

        return job, True

    def _lookup(self, tenant_id: uuid.UUID, key: str) -> IdempotencyRecord | None:
        stmt = select(IdempotencyRecord).where(
            IdempotencyRecord.tenant_id == tenant_id,
            IdempotencyRecord.idempotency_key == key,
        )
        return self._session.scalars(stmt).first()
