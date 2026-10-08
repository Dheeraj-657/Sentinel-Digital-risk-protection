"""Threat persistence: upsert + wholesale factor replacement.

Upsert key is the unique (tenant_id, brand_id, entity_id) triple. On
re-analysis, existing risk factors are replaced so the current threat view
always matches the latest AnalysisResult snapshot.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError, ErrorCode
from app.domain.enums import ThreatStatus
from app.models.analysis import AnalysisEvidenceReference, AnalysisResult
from app.models.base import utcnow
from app.models.threat import RiskFactor, Threat
from app.risk.calculator import ComputedFactor, RiskBreakdown
from app.schemas.entity import EvidenceReference


class ThreatService:
    def __init__(self, session: Session) -> None:
        self._session = session

    def find(self, tenant_id: uuid.UUID, brand_id: uuid.UUID, entity_id: uuid.UUID) -> Threat | None:
        stmt = select(Threat).where(
            Threat.tenant_id == tenant_id,
            Threat.brand_id == brand_id,
            Threat.entity_id == entity_id,
        )
        return self._session.scalars(stmt).first()

    def get_for_tenant(self, tenant_id: uuid.UUID, threat_id: uuid.UUID) -> Threat | None:
        stmt = select(Threat).where(Threat.tenant_id == tenant_id, Threat.id == threat_id)
        return self._session.scalars(stmt).first()

    def upsert(
        self,
        *,
        tenant_id: uuid.UUID,
        brand_id: uuid.UUID,
        entity_id: uuid.UUID,
        verdict,  # RiskVerdict
        model_version: str,
        evidence: list[EvidenceReference],
        analysis_timestamp: datetime | None = None,
    ) -> tuple[Threat, bool]:
        """Persist the verdict. Returns (threat, created)."""
        breakdown: RiskBreakdown = verdict.breakdown
        timestamp = analysis_timestamp or utcnow()

        threat = self.find(tenant_id, brand_id, entity_id)
        created = threat is None
        if threat is None:
            threat = Threat(
                tenant_id=tenant_id,
                brand_id=brand_id,
                entity_id=entity_id,
                status=ThreatStatus.OPEN,
            )
            self._session.add(threat)

        threat.risk_score = breakdown.total_score
        threat.risk_level = breakdown.level
        threat.classification = verdict.classification
        threat.confidence = breakdown.confidence
        threat.model_version = model_version
        threat.risk_engine_version = breakdown.engine_version
        threat.analysis_timestamp = timestamp

        threat.risk_factors.clear()
        for computed in breakdown.factors:
            threat.risk_factors.append(
                RiskFactor(
                    factor_type=computed.factor_type,
                    score=computed.score,
                    weight=computed.weight,
                    confidence=computed.confidence,
                    basis=computed.basis,
                    contribution=computed.contribution,
                    evidence_ids=list(computed.evidence_ids),
                )
            )

        self._session.flush()
        return threat, created

    def attach_evidence_references(
        self,
        result: AnalysisResult,
        factors: list[ComputedFactor],
        evidence_by_id: dict[str, EvidenceReference],
    ) -> None:
        """Link the analysis result to Module 3 evidence (deduplicated)."""
        usage: dict[str, set] = {}
        for factor in factors:
            for evidence_id in factor.evidence_ids:
                usage.setdefault(evidence_id, set()).add(factor.factor_type)
        for evidence_id, factor_types in usage.items():
            ref = evidence_by_id.get(evidence_id)
            if ref is None:
                raise AppError(
                    ErrorCode.INTERNAL_ERROR,
                    f"Factor cites evidence '{evidence_id}' that was not collected.",
                )
            result.evidence_references.append(
                AnalysisEvidenceReference(
                    evidence_id=ref.evidence_id,
                    source_id=ref.source_id,
                    factor_types=sorted(ft.value for ft in factor_types),
                )
            )

    def persist_result(
        self,
        *,
        job_id: uuid.UUID,
        tenant_id: uuid.UUID,
        threat: Threat,
        breakdown: RiskBreakdown,
        classification,
        model_version: str,
        analysis_timestamp: datetime,
    ) -> AnalysisResult:
        result = AnalysisResult(
            job_id=job_id,
            tenant_id=tenant_id,
            threat_id=threat.id,
            risk_score=breakdown.total_score,
            risk_level=breakdown.level.value,
            classification=classification.value,
            confidence=breakdown.confidence,
            model_version=model_version,
            risk_engine_version=breakdown.engine_version,
            analysis_timestamp=analysis_timestamp,
            factors=[
                {
                    "factor_type": f.factor_type.value,
                    "score": f.score,
                    "weight": f.weight,
                    "contribution": f.contribution,
                    "confidence": f.confidence,
                    "basis": f.basis.value,
                    "evidence_ids": list(f.evidence_ids),
                }
                for f in breakdown.factors
            ],
            evidence_count=sum(len(f.evidence_ids) for f in breakdown.factors),
        )
        self._session.add(result)
        self._session.flush()
        return result
