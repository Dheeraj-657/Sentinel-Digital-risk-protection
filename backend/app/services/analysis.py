"""Analysis orchestration: the full pipeline for one job.

Entity → Normalize → Identity/Text/Visual similarity → Domain/Behavioral/
Reputation/Relationship signals → Evidence aggregation → Risk engine →
Classification → Threat persistence → Event publication.

Every stage is a separately testable component; this module only sequences
them. API routes never call this directly — the worker queue does.
"""
from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.core.logging import audit, get_correlation_id, get_logger
from app.core.observability import metrics
from app.domain.enums import JobStatus
from app.events.schemas import (
    AnalysisCompletedEvent,
    AnalysisFailedEvent,
    AnalysisStartedEvent,
    RiskRecalculatedEvent,
    ThreatCreatedEvent,
    build_metadata,
)
from app.integrations.module1 import BrandDNAClient
from app.integrations.module3 import EntityProvider, EvidenceProvider
from app.ml.registry import ModelSet
from app.models.analysis import AnalysisJob
from app.models.base import utcnow
from app.services.evidence import EvidenceService
from app.services.risk_service import RiskService, computed_factor_signature
from app.services.signal_extraction import SignalExtractor
from app.services.threat_service import ThreatService

logger = get_logger("app.services.analysis")


class AnalysisExecutor:
    """Executes one analysis job synchronously. Runs inside the worker."""

    def __init__(
        self,
        session: Session,
        brand_client: BrandDNAClient,
        entity_provider: EntityProvider,
        evidence_provider: EvidenceProvider,
        models: ModelSet,
        risk_service: RiskService,
        evidence_service: EvidenceService,
        publisher=None,
    ) -> None:
        self._session = session
        self._brand_client = brand_client
        self._entity_provider = entity_provider
        self._evidence_provider = evidence_provider
        self._models = models
        self._extractor = SignalExtractor(models)
        self._risk_service = risk_service
        self._evidence_service = evidence_service
        self._threats = ThreatService(session)
        self._publisher = publisher

    def execute(self, job_id: uuid.UUID) -> None:
        job = self._session.get(AnalysisJob, job_id)
        if job is None or job.status not in (JobStatus.QUEUED, JobStatus.RUNNING):
            return

        correlation_id = get_correlation_id()
        timer = metrics.start_timer()
        with audit(logger, "analysis.execute", job_id=str(job_id)) as step:
            try:
                job.status = JobStatus.RUNNING
                job.started_at = job.started_at or utcnow()
                self._session.flush()
                self._publish(
                    AnalysisStartedEvent(
                        metadata=build_metadata("analysis.started", str(job.tenant_id), correlation_id),
                        job_id=str(job.id),
                        brand_id=str(job.brand_id),
                        entity_id=str(job.entity_id),
                    )
                )

                entity = self._entity_provider.get_entity(str(job.tenant_id), str(job.entity_id))
                dna = self._brand_client.get_brand_dna(str(job.brand_id))
                evidence = self._evidence_service.collect(str(job.tenant_id), str(job.entity_id))
                step.done(stage="inputs_collected", evidence_count=len(evidence))

                candidates = []
                for extractor in (
                    self._extractor.identity_factor,
                    self._extractor.text_factor,
                    self._extractor.visual_factor,
                    self._extractor.domain_factor,
                    self._extractor.behavioral_factor,
                    self._extractor.reputation_factor,
                    self._extractor.relationship_factor,
                ):
                    candidate = extractor(entity, dna, evidence)
                    if candidate is not None:
                        candidates.append(candidate)

                verdict = self._risk_service.evaluate([c.to_input() for c in candidates])
                model_version = self._models.version_string

                previous = self._threats.find(job.tenant_id, job.brand_id, job.entity_id)
                previous_signature = (
                    computed_factor_signature(list(previous.risk_factors))
                    if previous is not None and previous.risk_factors
                    else None
                )

                analysis_timestamp = utcnow()
                threat, created = self._threats.upsert(
                    tenant_id=job.tenant_id,
                    brand_id=job.brand_id,
                    entity_id=job.entity_id,
                    verdict=verdict,
                    model_version=model_version,
                    evidence=evidence,
                    analysis_timestamp=analysis_timestamp,
                )
                result = self._threats.persist_result(
                    job_id=job.id,
                    tenant_id=job.tenant_id,
                    threat=threat,
                    breakdown=verdict.breakdown,
                    classification=verdict.classification,
                    model_version=model_version,
                    analysis_timestamp=analysis_timestamp,
                )
                self._threats.attach_evidence_references(
                    result,
                    list(verdict.breakdown.factors),
                    {str(e.evidence_id): e for e in evidence},
                )

                job.status = JobStatus.COMPLETED
                job.completed_at = utcnow()
                self._session.flush()

                if created:
                    self._publish(
                        ThreatCreatedEvent(
                            metadata=build_metadata("threat.created", str(job.tenant_id), correlation_id),
                            threat_id=str(threat.id),
                            entity_id=str(threat.entity_id),
                            brand_id=str(threat.brand_id),
                            risk_score=threat.risk_score,
                            risk_level=threat.risk_level,
                            classification=threat.classification,
                            factor_types=[f.factor_type for f in verdict.breakdown.factors],
                        )
                    )
                elif previous_signature != computed_factor_signature(list(verdict.breakdown.factors)):
                    self._publish(
                        RiskRecalculatedEvent(
                            metadata=build_metadata("risk.recalculated", str(job.tenant_id), correlation_id),
                            threat_id=str(threat.id),
                            entity_id=str(threat.entity_id),
                            brand_id=str(threat.brand_id),
                            previous_score=(previous.risk_score if previous else 0),
                            new_score=threat.risk_score,
                            risk_level=threat.risk_level,
                            classification=threat.classification,
                        )
                    )

                self._publish(
                    AnalysisCompletedEvent(
                        metadata=build_metadata("analysis.completed", str(job.tenant_id), correlation_id),
                        job_id=str(job.id),
                        threat_id=str(threat.id),
                        risk_score=threat.risk_score,
                        risk_level=threat.risk_level,
                        classification=threat.classification,
                    )
                )

                duration = timer()
                metrics.observe("analysis_duration_seconds", duration, outcome="completed")
                metrics.inc_counter("analysis_total", outcome="completed")
                step.done(
                    stage="completed",
                    risk_score=threat.risk_score,
                    duration_seconds=round(duration, 6),
                )
            except Exception as exc:
                self._session.rollback()
                duration = timer()
                metrics.observe("analysis_duration_seconds", duration, outcome="failed")
                metrics.inc_counter("analysis_total", outcome="failed")
                # Only AppError carries an ErrorCode; SQLAlchemy et al. expose
                # unrelated `.code` attributes (e.g. the string 'gkpj').
                code_value = exc.code.value if isinstance(exc, AppError) else "INTERNAL_ERROR"
                tenant_id_str = str(getattr(job, "tenant_id", ""))
                logger.error(
                    "analysis.execute failed",
                    exc_info=exc,
                    extra={"context": {"job_id": str(job_id), "error_code": code_value}},
                )
                try:
                    fresh = self._session.get(AnalysisJob, job_id)
                    if fresh is not None:
                        fresh.status = JobStatus.FAILED
                        fresh.completed_at = utcnow()
                        fresh.error_code = code_value
                        fresh.error_message = str(exc)[:512]
                        self._session.commit()
                except Exception:
                    logger.exception("failed to persist FAILED job state", extra={"context": {"job_id": str(job_id)}})
                    self._session.rollback()
                if tenant_id_str:
                    self._publish(
                        AnalysisFailedEvent(
                            metadata=build_metadata("analysis.failed", tenant_id_str, correlation_id),
                            job_id=str(job_id),
                            error_code=code_value,
                        )
                    )
                raise

    def _publish(self, event) -> None:
        if self._publisher is not None:
            try:
                self._publisher.publish(event)
            except Exception:
                metadata = getattr(event, "metadata", None)
                logger.exception(
                    "event publication failed",
                    extra={"context": {"event_type": metadata.event_type if metadata else "unknown"}},
                )
