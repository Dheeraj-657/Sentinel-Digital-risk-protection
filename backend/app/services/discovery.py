"""Automatic threat discovery — the P1 vertical slice.

Pipeline: Brand DNA → bounded provider queries → raw candidates →
normalize (registrable domain) → exclude official domains → dedupe across
providers → persist sources + entities + evidence in Module 3 → chain
canonical Module 2 analysis for eligible candidates.

Honesty rules enforced here:
- Provider failures are recorded per provider; the job ends PARTIAL/FAILED —
  never a fabricated success.
- UNCONFIGURED providers are skipped with an outcome row; nothing is invented.
- Excluding a candidate because it matches the brand's own domain is a
  filter, not a judgment; nothing here asserts malice.
"""
from __future__ import annotations

import hashlib
import time
import uuid
from typing import Any, Callable

from sqlalchemy import func, select
from sqlalchemy.orm import Session, attributes

from app.core.config import Settings
from app.core.errors import AppError, EntityAlreadyExistsError, ErrorCode
from app.core.logging import get_logger
from app.domain.enums import DiscoveryJobStatus, EntityType, EvidenceType, JobStatus
from app.integrations.discovery.base import (
    FAILURE_STATUSES,
    STATUS_COMPLETED,
    STATUS_EMPTY,
    STATUS_UNCONFIGURED,
    SUCCESS_STATUSES,
    DiscoveryCandidate,
    DiscoveryProvider,
    DiscoveryProviderError,
    DiscoveryQuery,
    ProviderOutcome,
)
from app.integrations.module3.writer import Module3Writer
from app.models.analysis import AnalysisJob
from app.models.base import utcnow
from app.models.discovery import DiscoveryJob
from app.schemas.brand_dna import BrandDNA
from app.services.analysis import AnalysisExecutor
from app.services.normalization import registrable_domain

logger = get_logger("app.services.discovery")

AnalysisEnqueuer = Callable[[uuid.UUID], None]


class DiscoveryJobService:
    """CRUD over discovery jobs — tenant-scoped, no engine logic."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def create(self, tenant_id: uuid.UUID, brand_id: uuid.UUID) -> DiscoveryJob:
        job = DiscoveryJob(tenant_id=tenant_id, brand_id=brand_id)
        self._session.add(job)
        self._session.flush()
        return job

    def get(self, tenant_id: uuid.UUID, job_id: uuid.UUID) -> DiscoveryJob | None:
        return self._session.scalars(
            select(DiscoveryJob).where(
                DiscoveryJob.id == job_id, DiscoveryJob.tenant_id == tenant_id
            )
        ).first()

    def list_for_tenant(
        self,
        tenant_id: uuid.UUID,
        *,
        limit: int = 50,
        offset: int = 0,
        status: DiscoveryJobStatus | None = None,
    ) -> tuple[list[DiscoveryJob], int]:
        conditions = [DiscoveryJob.tenant_id == tenant_id]
        if status is not None:
            conditions.append(DiscoveryJob.status == status)
        total = (
            self._session.scalar(
                select(func.count())
                .select_from(DiscoveryJob)
                .where(*conditions)
            )
            or 0
        )
        jobs = self._session.scalars(
            select(DiscoveryJob)
            .where(*conditions)
            .order_by(DiscoveryJob.created_at.desc(), DiscoveryJob.id)
            .limit(limit)
            .offset(offset)
        ).all()
        return list(jobs), total


def candidate_fingerprint(kind: str, domain: str | None, url: str | None) -> str:
    """Stable identity of an observation across runs — used to avoid
    duplicating evidence on retries and re-discoveries."""
    raw = f"{kind}|{domain or ''}|{url or ''}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def normalize_candidates(
    candidates: list[DiscoveryCandidate], official_domains: set[str]
) -> tuple[list[dict[str, Any]], int]:
    """Registrable-domain normalization, official-domain exclusion, and
    cross-provider deduplication. Returns (candidate dicts, duplicate_count).

    Candidates from different providers resolving to the same registrable
    domain are merged into one record listing every observing provider —
    count once, cite both.
    """
    merged: dict[str, dict[str, Any]] = {}
    duplicates = 0
    for candidate in candidates:
        raw_domain = candidate.domain or ""
        registrable = registrable_domain(raw_domain) or registrable_domain(
            candidate.url or ""
        )
        if not registrable or registrable in official_domains:
            continue
        existing = merged.get(registrable)
        if existing is not None:
            duplicates += 1
            if candidate.provider not in existing["providers"]:
                existing["providers"].append(candidate.provider)
            continue
        merged[registrable] = {
            "providers": [candidate.provider],
            "kind": candidate.kind,
            "domain": registrable,
            "url": candidate.url,
            "title": candidate.title,
            "snippet": candidate.snippet,
            "query_basis": candidate.query_basis,
            "observed_at": candidate.observed_at.isoformat(),
            "discovery_fingerprint": candidate_fingerprint(
                candidate.kind, registrable, candidate.url
            ),
            "entity_id": None,
            "evidence_id": None,
            "analysis_job_id": None,
            "analysis_status": None,
        }
    return list(merged.values()), duplicates


class DiscoveryExecutor:
    """Executes one discovery job end-to-end. Mirrors AnalysisExecutor's
    failure contract: any unhandled error persists job FAILED and re-raises."""

    def __init__(
        self,
        *,
        session: Session,
        brand_client,
        module3_writer: Module3Writer,
        providers: list[DiscoveryProvider],
        evidence_provider,
        settings: Settings,
        analysis_enqueuer: AnalysisEnqueuer,
    ) -> None:
        self._session = session
        self._brand_client = brand_client
        self._writer = module3_writer
        self._providers = providers
        self._evidence_provider = evidence_provider
        self._settings = settings
        self._analysis_enqueuer = analysis_enqueuer

    def execute(self, job_id: uuid.UUID) -> None:
        try:
            self._run(job_id)
        except Exception as exc:
            logger.exception(
                "discovery job failed",
                extra={"context": {"job_id": str(job_id)}},
            )
            self._persist_failure(job_id, exc)
            raise

    def _persist_failure(self, job_id: uuid.UUID, exc: Exception) -> None:
        self._session.rollback()
        job = self._session.get(DiscoveryJob, job_id)
        if job is None:
            return
        job.status = DiscoveryJobStatus.FAILED
        job.error_code = exc.code.value if isinstance(exc, AppError) else "INTERNAL_ERROR"
        job.error_message = str(exc)[:512]
        job.completed_at = utcnow()
        self._session.commit()

    def _run(self, job_id: uuid.UUID) -> None:
        job = self._session.get(DiscoveryJob, job_id)
        if job is None:
            return
        job.status = DiscoveryJobStatus.RUNNING
        job.started_at = utcnow()
        self._session.commit()

        tenant_id = str(job.tenant_id)
        brand_id = str(job.brand_id)

        dna: BrandDNA = self._brand_client.get_brand_dna(brand_id)

        official_domains = {
            registrable_domain(d.domain)
            for d in dna.domains
            if registrable_domain(d.domain)
        } | {
            registrable_domain(v)
            for v in dna.verification.verified_domains
            if registrable_domain(v)
        }

        all_queries: list[dict[str, str]] = []
        outcomes: list[ProviderOutcome] = []
        raw_candidates: list[DiscoveryCandidate] = []

        for provider in self._providers:
            if not provider.available():
                outcomes.append(
                    ProviderOutcome(
                        provider=provider.name, status=STATUS_UNCONFIGURED
                    )
                )
                continue
            queries = provider.queries_for(dna)[
                : self._settings.discovery_max_queries_per_provider
            ]
            all_queries.extend(
                {"provider": provider.name, "term": q.term, "basis": q.basis}
                for q in queries
            )
            started = time.monotonic()
            try:
                found = provider.discover(
                    queries, self._settings.discovery_max_candidates_per_provider
                )
            except DiscoveryProviderError as exc:
                outcomes.append(
                    ProviderOutcome(
                        provider=provider.name,
                        status=exc.status,
                        error=exc.detail,
                        latency_ms=int((time.monotonic() - started) * 1000),
                    )
                )
                logger.warning(
                    "discovery_provider_failed",
                    extra={"context": {"provider": provider.name, "status": exc.status}},
                )
                continue
            status = STATUS_COMPLETED if found else STATUS_EMPTY
            outcomes.append(
                ProviderOutcome(
                    provider=provider.name,
                    status=status,
                    candidate_count=len(found),
                    latency_ms=int((time.monotonic() - started) * 1000),
                )
            )
            raw_candidates.extend(found)

            # Checkpoint after each provider so a later crash preserves
            # exactly what was observed and what failed.
            job.queries = list(all_queries)
            job.provider_outcomes = [o.model_dump(mode="json") for o in outcomes]
            self._session.commit()

        job.queries = list(all_queries)
        job.provider_outcomes = [o.model_dump(mode="json") for o in outcomes]
        self._session.commit()

        if not outcomes:
            raise AppError(
                ErrorCode.INTEGRATION_UNAVAILABLE,
                "No discovery providers are configured.",
                http_status=503,
            )

        normalized, duplicates = normalize_candidates(raw_candidates, official_domains)
        normalized = normalized[: self._settings.discovery_max_candidates_total]
        job.duplicate_count = duplicates
        job.candidates = normalized
        self._session.commit()

        self._persist_to_module3(job, tenant_id, normalized)
        self._chain_analysis(job, tenant_id, brand_id, normalized)

        final = self._final_status(outcomes)
        job.status = final
        unconfigured = [o.provider for o in outcomes if o.status == STATUS_UNCONFIGURED]
        if unconfigured:
            note = (
                f"{len(unconfigured)} provider(s) unconfigured "
                f"({', '.join(unconfigured)}); no evidence was fabricated for them."
            )
            job.warning_message = (
                f"{job.warning_message} {note}" if job.warning_message else note
            )[:512]
        if final is DiscoveryJobStatus.FAILED:
            # All providers failed: the failure is the result. Record why the
            # job failed rather than returning an unexplained FAILED.
            failures = "; ".join(
                f"{o.provider}: {o.error or o.status}"
                for o in outcomes
                if o.status in FAILURE_STATUSES
            )
            job.error_code = ErrorCode.INTEGRATION_UNAVAILABLE.value
            job.error_message = f"All discovery providers failed. {failures}"[:512]
        job.completed_at = utcnow()
        self._session.commit()

    def _persist_to_module3(
        self, job: DiscoveryJob, tenant_id: str, candidates: list[dict[str, Any]]
    ) -> None:
        source_ids: dict[str, str] = dict(job.source_ids or {})
        for candidate in candidates:
            if candidate["evidence_id"]:
                # Retry of a previously persisted candidate — never duplicate.
                continue
            provider = candidate["providers"][0]
            source_id = self._source_for(tenant_id, provider, source_ids)
            entity_id = self._entity_for(job, tenant_id, candidate)
            evidence_id = self._evidence_for(
                job, tenant_id, candidate, entity_id, source_id
            )
            candidate["entity_id"] = str(entity_id)
            candidate["evidence_id"] = str(evidence_id)
            # In-place dict mutations are invisible to SQLAlchemy's value
            # comparison — flag the JSON columns dirty or they never UPDATE.
            attributes.flag_modified(job, "candidates")
            attributes.flag_modified(job, "source_ids")
            self._session.commit()

    def _source_for(
        self, tenant_id: str, provider: str, source_ids: dict[str, str]
    ) -> Any:
        if provider in source_ids:
            return source_ids[provider]
        source_id = self._writer.create_source(
            tenant_id, name=f"TRUSTGRAPH discovery: {provider}", kind=f"discovery-{provider}"
        )
        source_ids[provider] = str(source_id)
        return source_id

    def _entity_for(self, job: DiscoveryJob, tenant_id: str, candidate: dict[str, Any]) -> Any:
        attributes: dict[str, Any] = {
            "origin": "discovery",
            "discovery_job_id": str(job.id),
        }
        if candidate.get("title"):
            attributes["title"] = candidate["title"]
        if candidate.get("snippet"):
            attributes["snippet"] = candidate["snippet"]
        identifiers: dict[str, str] = {"domain": candidate["domain"]}
        try:
            return self._writer.create_entity(
                tenant_id,
                entity_type=EntityType.WEBSITE.value,
                display_name=candidate["domain"],
                identifiers=identifiers,
                attributes=attributes,
            )
        except EntityAlreadyExistsError as exc:
            return uuid.UUID(exc.existing_entity_id)

    def _evidence_for(
        self,
        job: DiscoveryJob,
        tenant_id: str,
        candidate: dict[str, Any],
        entity_id: Any,
        source_id: Any,
    ) -> Any:
        fingerprint = candidate["discovery_fingerprint"]
        existing_items = self._evidence_provider.list_evidence(
            tenant_id, str(entity_id)
        )
        for item in existing_items:
            if item.metadata.get("discovery_fingerprint") == fingerprint:
                return item.evidence_id

        observed = candidate["observed_at"]
        if candidate["kind"] == "certificate":
            text = (
                f"Certificate Transparency log entry for domain "
                f"{candidate['domain']} (query basis: {candidate['query_basis']}). "
                "A certificate proves the domain exists — not that it is malicious."
            )
        else:
            text = ". ".join(
                part for part in (candidate.get("title"), candidate.get("snippet")) if part
            ) or None
        return self._writer.create_evidence(
            tenant_id,
            entity_id,
            source_id=source_id,
            evidence_type=EvidenceType.DOMAIN_INTEL.value,
            collected_at=observed,
            text=text,
            url=candidate.get("url"),
            metadata={
                "provider": candidate["providers"][0],
                "query_basis": candidate["query_basis"],
                "discovery_job_id": str(job.id),
                "observed_at": observed,
                "discovery_fingerprint": fingerprint,
            },
        )

    def _chain_analysis(
        self,
        job: DiscoveryJob,
        tenant_id: str,
        brand_id: str,
        candidates: list[dict[str, Any]],
    ) -> None:
        eligible = [c for c in candidates if c["entity_id"] and c["evidence_id"]]
        bounded = eligible[: self._settings.discovery_max_analysis_per_job]
        if len(eligible) > len(bounded):
            job.warning_message = (
                f"Analysis capped at {len(bounded)} of {len(eligible)} candidates."
            )
        for candidate in bounded:
            analysis_job = AnalysisJob(
                tenant_id=uuid.UUID(tenant_id),
                brand_id=uuid.UUID(brand_id),
                entity_id=uuid.UUID(candidate["entity_id"]),
            )
            self._session.add(analysis_job)
            # Commit BEFORE chaining: the analysis executor uses its own
            # session and must see the row (and not contend on ours).
            self._session.commit()
            candidate["analysis_job_id"] = str(analysis_job.id)
            try:
                self._analysis_enqueuer(analysis_job.id)
            except Exception as exc:
                logger.warning(
                    "discovery_chained_analysis_failed",
                    extra={
                        "context": {
                            "analysis_job_id": str(analysis_job.id),
                            "error": type(exc).__name__,
                        }
                    },
                )
                candidate["analysis_status"] = JobStatus.FAILED.value
            else:
                try:
                    self._session.refresh(analysis_job)
                    candidate["analysis_status"] = analysis_job.status.value
                except Exception:
                    candidate["analysis_status"] = JobStatus.QUEUED.value
            attributes.flag_modified(job, "candidates")
            self._session.commit()

    def _final_status(self, outcomes: list[ProviderOutcome]) -> DiscoveryJobStatus:
        statuses = {o.status for o in outcomes}
        if statuses <= {STATUS_UNCONFIGURED}:
            return DiscoveryJobStatus.COMPLETED
        if statuses & SUCCESS_STATUSES and statuses & FAILURE_STATUSES:
            return DiscoveryJobStatus.PARTIAL
        if statuses & FAILURE_STATUSES:
            # Any hard failure with zero successful providers is a failed run —
            # never a green COMPLETED. Unconfigured providers don't soften it.
            return DiscoveryJobStatus.FAILED
        return DiscoveryJobStatus.COMPLETED


def discovery_executor_factory(
    *,
    brand_client,
    module3_writer: Module3Writer,
    providers: list[DiscoveryProvider],
    evidence_provider,
    settings: Settings,
    analysis_enqueuer: AnalysisEnqueuer,
) -> Callable[[Session], DiscoveryExecutor]:
    """Bind process-wide collaborators once; each job gets a fresh session."""

    def _build(session: Session) -> DiscoveryExecutor:
        return DiscoveryExecutor(
            session=session,
            brand_client=brand_client,
            module3_writer=module3_writer,
            providers=providers,
            evidence_provider=evidence_provider,
            settings=settings,
            analysis_enqueuer=analysis_enqueuer,
        )

    return _build
