"""Threat endpoints — the stable Module 4 contract surface."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_tenant
from app.core.errors import AppError, ErrorCode
from app.core.logging import audit, get_correlation_id
from app.domain.enums import RiskLevel, ThreatStatus
from app.events.schemas import ThreatStatusChangedEvent, build_metadata
from app.models.analysis import AnalysisResult
from app.models.threat import Threat
from app.schemas.threat import (
    RelatedThreatsResponse,
    ThreatListResponse,
    ThreatResponse,
    ThreatStatusUpdateRequest,
    ThreatSummary,
)
from app.services.relations import RelatedThreatService
from app.services.threat_service import ThreatService

router = APIRouter(prefix="/threats", tags=["threats"])


def _serialize_threat(db: Session, threat: Threat) -> ThreatResponse:
    """ThreatResponse.evidence_references resolves from the threat's latest
    analysis snapshot — the references live on AnalysisResult, not Threat."""
    latest = db.scalars(
        select(AnalysisResult)
        .where(AnalysisResult.threat_id == threat.id)
        .order_by(AnalysisResult.created_at.desc())
        .limit(1)
    ).first()
    return ThreatResponse.model_validate({
        "threat_id": threat.id,
        "tenant_id": threat.tenant_id,
        "brand_id": threat.brand_id,
        "entity_id": threat.entity_id,
        "risk_score": threat.risk_score,
        "risk_level": threat.risk_level,
        "classification": threat.classification,
        "confidence": threat.confidence,
        "status": threat.status,
        "model_version": threat.model_version,
        "risk_engine_version": threat.risk_engine_version,
        "analysis_timestamp": threat.analysis_timestamp,
        "created_at": threat.created_at,
        "updated_at": threat.updated_at,
        "risk_factors": threat.risk_factors,
        "evidence_references": latest.evidence_references if latest else [],
    })

# Analyst lifecycle: OPEN ⇄ CONFIRMED / DISMISSED. Direct CONFIRMED↔DISMISSED
# jumps are rejected — a dismissal decision must pass through OPEN (re-review).
_ALLOWED_TRANSITIONS = {
    (ThreatStatus.OPEN, ThreatStatus.CONFIRMED),
    (ThreatStatus.OPEN, ThreatStatus.DISMISSED),
    (ThreatStatus.CONFIRMED, ThreatStatus.OPEN),
    (ThreatStatus.DISMISSED, ThreatStatus.OPEN),
}


@router.get("", response_model=ThreatListResponse)
def list_threats(
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_tenant),
    status: ThreatStatus | None = None,
    risk_level: RiskLevel | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> ThreatListResponse:
    conditions = [Threat.tenant_id == tenant_id]
    if status is not None:
        conditions.append(Threat.status == status)
    if risk_level is not None:
        conditions.append(Threat.risk_level == risk_level)

    total = db.scalar(select(func.count()).select_from(Threat).where(*conditions)) or 0
    stmt = (
        select(Threat)
        .where(*conditions)
        .order_by(Threat.risk_score.desc(), Threat.analysis_timestamp.desc())
        .limit(limit)
        .offset(offset)
    )
    items = list(db.scalars(stmt).all())
    return ThreatListResponse(items=items, total=int(total), limit=limit, offset=offset)


@router.get("/{threat_id}", response_model=ThreatResponse)
def get_threat(
    threat_id: uuid.UUID,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_tenant),
) -> ThreatResponse:
    threat = ThreatService(db).get_for_tenant(tenant_id, threat_id)
    if threat is None:
        raise AppError(
            ErrorCode.NOT_FOUND,
            f"Threat '{threat_id}' was not found.",
            http_status=404,
            details={"threat_id": str(threat_id)},
        )
    return _serialize_threat(db, threat)


@router.get("/{threat_id}/related", response_model=RelatedThreatsResponse)
def get_related_threats(
    threat_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_tenant),
) -> RelatedThreatsResponse:
    """Threats related by an exact stored-attribute match — never by name
    similarity. See RelatedThreatService for the honesty policy."""
    service = RelatedThreatService(
        db, request.app.state.entity_provider, request.app.state.evidence_provider
    )
    threat, relations, warnings = service.find_related(tenant_id, threat_id)
    if threat is None:
        raise AppError(
            ErrorCode.NOT_FOUND,
            f"Threat '{threat_id}' was not found.",
            http_status=404,
            details={"threat_id": str(threat_id)},
        )
    return RelatedThreatsResponse(
        threat_id=threat.id, items=relations, total=len(relations), warnings=warnings
    )


@router.patch("/{threat_id}/status", response_model=ThreatResponse)
def update_threat_status(
    threat_id: uuid.UUID,
    body: ThreatStatusUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_tenant),
) -> ThreatResponse:
    with audit(request.app.state.logger, "threat.status_update",
               threat_id=str(threat_id), new_status=body.status.value):
        threat = ThreatService(db).get_for_tenant(tenant_id, threat_id)
        if threat is None:
            raise AppError(
                ErrorCode.NOT_FOUND,
                f"Threat '{threat_id}' was not found.",
                http_status=404,
                details={"threat_id": str(threat_id)},
            )
        if (threat.status, body.status) not in _ALLOWED_TRANSITIONS:
            raise AppError(
                ErrorCode.INVALID_STATUS_TRANSITION,
                (
                    f"Transition {threat.status.value} -> {body.status.value} is not "
                    "allowed; reopen the threat (OPEN) before re-deciding."
                ),
                http_status=409,
                details={"current_status": threat.status.value,
                         "requested_status": body.status.value},
            )
        previous = threat.status
        threat.status = body.status
        db.flush()

        request.app.state.publisher.publish(
            ThreatStatusChangedEvent(
                metadata=build_metadata(
                    "threat.status_changed", str(tenant_id), get_correlation_id()
                ),
                threat_id=str(threat.id),
                previous_status=previous.value,
                new_status=body.status.value,
            )
        )
    return _serialize_threat(db, threat)
