"""End-to-end pipeline tests: job → executor → threat/result persistence → events.

Uses the MOCK Module 1/3 adapters and SYNTHETIC TEST_ONLY data. These tests
verify the orchestrator contract; ML/risk internals have their own suites.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app.core.errors import AppError, ErrorCode
from app.domain.enums import EvidenceBasis, EvidenceType, JobStatus, ThreatStatus
from app.events.publisher import InMemoryEventPublisher
from app.models.analysis import AnalysisEvidenceReference, AnalysisJob, AnalysisResult
from app.models.threat import RiskFactor, Threat
from app.schemas.entity import EvidenceReference
from app.services.analysis import AnalysisExecutor


def make_executor(session, brand_client, entity_provider, evidence_provider,
                  model_set, risk_service, evidence_service, publisher):
    return AnalysisExecutor(
        session=session,
        brand_client=brand_client,
        entity_provider=entity_provider,
        evidence_provider=evidence_provider,
        models=model_set,
        risk_service=risk_service,
        evidence_service=evidence_service,
        publisher=publisher,
    )


def create_job(session, tenant_id, brand_id, entity_id) -> AnalysisJob:
    job = AnalysisJob(tenant_id=tenant_id, brand_id=brand_id, entity_id=entity_id)
    session.add(job)
    session.commit()
    return job


def published_types(publisher: InMemoryEventPublisher) -> list[str]:
    return [e["metadata"]["event_type"] for e in publisher.events]


class TestHappyPath:
    def test_completes_and_persists_threat_result_events(
        self, session, tenant_id, brand_id, entity_id, brand_client,
        entity_provider, evidence_provider, model_set, risk_service,
        evidence_service, publisher,
    ):
        job = create_job(session, tenant_id, brand_id, entity_id)
        executor = make_executor(session, brand_client, entity_provider,
                                 evidence_provider, model_set, risk_service,
                                 evidence_service, publisher)

        executor.execute(job.id)

        session.refresh(job)
        assert job.status == JobStatus.COMPLETED
        assert job.started_at is not None
        assert job.completed_at is not None
        assert job.error_code is None

        threat = session.scalars(
            select(Threat).where(Threat.tenant_id == tenant_id)
        ).one()
        assert threat.status == ThreatStatus.OPEN
        assert threat.risk_score == job.result.risk_score
        assert 0 <= threat.risk_score <= 100
        assert len(threat.risk_factors) > 0
        for factor in threat.risk_factors:
            assert isinstance(factor, RiskFactor)
            assert 0 <= factor.score <= 100
            assert factor.evidence_ids, "every factor must cite evidence"
            assert factor.basis in list(EvidenceBasis)

        result = session.scalars(select(AnalysisResult)).one()
        assert result.tenant_id == tenant_id, "result must carry tenant for isolation"
        assert result.job_id == job.id
        assert result.threat_id == threat.id
        assert result.evidence_count > 0
        assert result.factors, "snapshot must include factor breakdown"
        for factor_snapshot in result.factors:
            assert {"factor_type", "score", "weight", "contribution",
                    "confidence", "basis", "evidence_ids"} <= set(factor_snapshot)

        references = session.scalars(select(AnalysisEvidenceReference)).all()
        assert len(references) == len({r.evidence_id for r in references}), "deduped"
        assert references, "at least the cited evidence must be linked"

        assert published_types(publisher) == [
            "analysis.started",
            "threat.created",
            "analysis.completed",
        ]

    def test_deterministic_rerun_updates_existing_threat(
        self, session, tenant_id, brand_id, entity_id, brand_client,
        entity_provider, evidence_provider, model_set, risk_service,
        evidence_service, publisher,
    ):
        executor = make_executor(session, brand_client, entity_provider,
                                 evidence_provider, model_set, risk_service,
                                 evidence_service, publisher)

        job1 = create_job(session, tenant_id, brand_id, entity_id)
        executor.execute(job1.id)
        job2 = create_job(session, tenant_id, brand_id, entity_id)
        executor.execute(job2.id)

        threats = session.scalars(select(Threat)).all()
        assert len(threats) == 1, "upsert on (tenant, brand, entity)"
        assert len(session.scalars(select(AnalysisResult)).all()) == 2
        # Identical inputs → identical factor signature → no risk.recalculated
        # event spam on duplicate analyses.
        assert published_types(publisher) == [
            "analysis.started", "threat.created", "analysis.completed",
            "analysis.started", "analysis.completed",
        ]

    def test_changed_inputs_fire_risk_recalculated(
        self, session, tenant_id, brand_id, entity_id, brand_client,
        entity_provider, evidence_provider, model_set, risk_service,
        evidence_service, publisher,
    ):
        executor = make_executor(session, brand_client, entity_provider,
                                 evidence_provider, model_set, risk_service,
                                 evidence_service, publisher)
        job1 = create_job(session, tenant_id, brand_id, entity_id)
        executor.execute(job1.id)

        # New behavioral evidence changes the factor set on the second run.
        evidence_provider.add(
            EvidenceReference(
                evidence_id=uuid.uuid4(),
                source_id=uuid.uuid4(),
                entity_id=entity_id,
                evidence_type=EvidenceType.REPUTATION_INTEL,
                collected_at=datetime.now(timezone.utc),
                metadata={"blocklisted": True},
            )
        )
        job2 = create_job(session, tenant_id, brand_id, entity_id)
        executor.execute(job2.id)

        assert published_types(publisher) == [
            "analysis.started", "threat.created", "analysis.completed",
            "analysis.started", "risk.recalculated", "analysis.completed",
        ]


class TestFailurePaths:
    def test_missing_brand_dna_marks_job_failed(
        self, session, tenant_id, brand_id, entity_id, entity_provider,
        evidence_provider, model_set, risk_service, evidence_service, publisher,
    ):
        from app.integrations.module1.mock import MockBrandDNAClient

        job = create_job(session, tenant_id, brand_id, entity_id)
        executor = make_executor(session, MockBrandDNAClient(), entity_provider,
                                 evidence_provider, model_set, risk_service,
                                 evidence_service, publisher)

        with pytest.raises(AppError) as excinfo:
            executor.execute(job.id)

        session.refresh(job)
        assert job.status == JobStatus.FAILED
        assert job.error_code == ErrorCode.MISSING_BRAND_DNA.value
        assert job.completed_at is not None
        assert published_types(publisher) == ["analysis.started", "analysis.failed"]
        assert publisher.events[-1]["data"]["error_code"] == ErrorCode.MISSING_BRAND_DNA.value

    def test_non_app_error_becomes_internal_error(
        self, session, tenant_id, brand_id, entity_id, brand_client,
        entity_provider, evidence_provider, model_set, risk_service,
        evidence_service, publisher,
    ):
        """ORM/other libraries attach string `.code` attributes to their
        exceptions; the failure handler must not mistake them for ErrorCodes."""

        class ExplodingProvider:
            def get_entity(self, _tenant_id: str, _entity_id: str):
                raise RuntimeError("boom")

        job = create_job(session, tenant_id, brand_id, entity_id)
        executor = make_executor(session, brand_client, ExplodingProvider(),
                                 evidence_provider, model_set, risk_service,
                                 evidence_service, publisher)

        with pytest.raises(RuntimeError):
            executor.execute(job.id)

        session.refresh(job)
        assert job.status == JobStatus.FAILED
        assert job.error_code == "INTERNAL_ERROR"
