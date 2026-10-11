"""Idempotency service and job queue tests. SYNTHETIC TEST_ONLY data."""
from __future__ import annotations

import asyncio
import uuid
from datetime import timedelta

import pytest
from sqlalchemy import select

from app.core.errors import DuplicateJobError
from app.models.analysis import AnalysisJob
from app.models.base import utcnow
from app.models.idempotency import IdempotencyRecord
from app.services.idempotency import IdempotencyService, fingerprint_request
from app.services.queue import InProcessJobQueue, SyncJobQueue, executor_factory
from tests.conftest import BRAND_LOGO_PHASH


class TestFingerprint:
    def test_key_order_insensitive(self):
        a = fingerprint_request({"brand_id": "x", "entity_id": "y"})
        b = fingerprint_request({"entity_id": "y", "brand_id": "x"})
        assert a == b
        assert len(a) == 64

    def test_different_payload_different_fingerprint(self):
        assert fingerprint_request({"a": 1}) != fingerprint_request({"a": 2})


class TestIdempotencyService:
    def submit(self, session, tenant_id, brand_id, entity_id, key, payload,
               retention_hours=24):
        service = IdempotencyService(session, retention_hours)
        job, created = service.submit(
            tenant_id=tenant_id,
            brand_id=brand_id,
            entity_id=entity_id,
            idempotency_key=key,
            fingerprint=fingerprint_request(payload),
        )
        session.commit()
        return job, created

    def test_same_key_same_payload_replays_job(
        self, session, tenant_id, brand_id, entity_id
    ):
        payload = {"brand_id": str(brand_id), "entity_id": str(entity_id)}
        job1, created1 = self.submit(session, tenant_id, brand_id, entity_id,
                                     "key-1", payload)
        job2, created2 = self.submit(session, tenant_id, brand_id, entity_id,
                                     "key-1", payload)
        assert created1 is True
        assert created2 is False
        assert job1.id == job2.id
        assert session.scalars(select(AnalysisJob)).all() == [job1]

    def test_same_key_different_payload_conflicts(
        self, session, tenant_id, brand_id, entity_id
    ):
        self.submit(session, tenant_id, brand_id, entity_id, "key-1",
                    {"brand_id": str(brand_id)})
        with pytest.raises(DuplicateJobError):
            self.submit(session, tenant_id, brand_id, entity_id, "key-1",
                        {"brand_id": str(brand_id), "entity_id": str(entity_id)})

    def test_no_key_always_creates(self, session, tenant_id, brand_id, entity_id):
        payload = {"brand_id": str(brand_id)}
        _, c1 = self.submit(session, tenant_id, brand_id, entity_id, None, payload)
        _, c2 = self.submit(session, tenant_id, brand_id, entity_id, None, payload)
        assert c1 and c2
        assert len(session.scalars(select(AnalysisJob)).all()) == 2

    def test_keys_are_tenant_scoped(self, session, tenant_id, brand_id, entity_id):
        other_tenant = uuid.uuid4()
        payload = {"brand_id": str(brand_id)}
        job1, _ = self.submit(session, tenant_id, brand_id, entity_id, "shared", payload)
        job2, created2 = self.submit(session, other_tenant, brand_id, entity_id,
                                     "shared", payload)
        assert created2 is True
        assert job1.id != job2.id

    def test_expired_key_allows_resubmission(self, session, tenant_id, brand_id, entity_id):
        payload = {"brand_id": str(brand_id)}
        job1, _ = self.submit(session, tenant_id, brand_id, entity_id, "key-1",
                              payload, retention_hours=0)
        # Backdate the record to force expiry.
        record = session.scalars(select(IdempotencyRecord)).one()
        record.expires_at = utcnow() - timedelta(seconds=1)
        session.commit()

        job2, created2 = self.submit(session, tenant_id, brand_id, entity_id,
                                     "key-1", payload)
        assert created2 is True
        assert job2.id != job1.id


def build_factory(brand_client, entity_provider, evidence_provider, model_set,
                  risk_service, evidence_service, publisher):
    return executor_factory(
        brand_client=brand_client,
        entity_provider=entity_provider,
        evidence_provider=evidence_provider,
        models=model_set,
        risk_service=risk_service,
        evidence_service=evidence_service,
        publisher=publisher,
    )


class TestSyncQueue:
    def test_executes_inline(
        self, session_factory, session, tenant_id, brand_id, entity_id,
        brand_client, entity_provider, evidence_provider, model_set,
        risk_service, evidence_service, publisher,
    ):
        job = AnalysisJob(tenant_id=tenant_id, brand_id=brand_id, entity_id=entity_id)
        session.add(job)
        session.commit()

        queue = SyncJobQueue(
            build_factory(brand_client, entity_provider, evidence_provider,
                          model_set, risk_service, evidence_service, publisher),
            session_factory,
        )
        asyncio.run(queue.enqueue(job.id))

        session.refresh(job)
        assert job.status.value == "COMPLETED"
        assert [e["metadata"]["event_type"] for e in publisher.events] == [
            "analysis.started", "threat.created", "analysis.completed",
        ]


class TestInProcessQueue:
    def test_workers_drain_jobs(
        self, session_factory, session, tenant_id, brand_id, entity_id,
        brand_client, entity_provider, evidence_provider, model_set,
        risk_service, evidence_service, publisher,
    ):
        job_ids = []
        for _ in range(3):
            job = AnalysisJob(tenant_id=tenant_id, brand_id=brand_id,
                              entity_id=entity_id)
            session.add(job)
            session.commit()
            job_ids.append(job.id)

        queue = InProcessJobQueue(
            build_factory(brand_client, entity_provider, evidence_provider,
                          model_set, risk_service, evidence_service, publisher),
            session_factory,
            concurrency=1,
        )

        async def scenario():
            await queue.start()
            for jid in job_ids:
                await queue.enqueue(jid)
            await asyncio.wait_for(queue.join(), timeout=30)
            await queue.stop()

        asyncio.run(scenario())

        session.expire_all()  # identity map still holds pre-execution state
        statuses = {jid: session.get(AnalysisJob, jid).status for jid in job_ids}
        assert all(s == "COMPLETED" for s in statuses.values()), statuses

    def test_failed_job_does_not_kill_workers(
        self, session_factory, session, tenant_id, brand_id, entity_id,
        brand_client, entity_provider, evidence_provider, model_set,
        risk_service, evidence_service, publisher,
    ):
        from app.integrations.module1.mock import MockBrandDNAClient

        # First job references a brand with no DNA → fails; second succeeds.
        missing_brand = uuid.uuid4()
        failing = AnalysisJob(tenant_id=tenant_id, brand_id=missing_brand,
                              entity_id=entity_id)
        succeeding = AnalysisJob(tenant_id=tenant_id, brand_id=brand_id,
                                 entity_id=entity_id)
        session.add_all([failing, succeeding])
        session.commit()

        queue = InProcessJobQueue(
            build_factory(brand_client, entity_provider, evidence_provider,
                          model_set, risk_service, evidence_service, publisher),
            session_factory,
            concurrency=1,
        )

        async def scenario():
            await queue.start()
            await queue.enqueue(failing.id)
            await queue.enqueue(succeeding.id)
            await asyncio.wait_for(queue.join(), timeout=30)
            await queue.stop()

        asyncio.run(scenario())

        session.refresh(failing)
        session.refresh(succeeding)
        assert failing.status == "FAILED"
        assert succeeding.status == "COMPLETED"


@pytest.fixture
def session_factory(engine):
    from sqlalchemy.orm import sessionmaker

    return sessionmaker(bind=engine, expire_on_commit=False)
