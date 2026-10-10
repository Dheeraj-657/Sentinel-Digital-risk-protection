from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.domain.enums import (
    EvidenceBasis,
    FactorType,
    RiskLevel,
    ThreatClassification,
    ThreatStatus,
)
from app.models.base import (
    Base,
    TimestampMixin,
    UTCDateTime,
    UUIDPrimaryKeyMixin,
    utcnow,
)


class Threat(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Risk-engine verdict for one (tenant, brand, entity) triple.

    brand_id / entity_id are EXTERNAL references (Module 1 / Module 3 own
    those aggregates); no foreign keys are fabricated against tables that
    do not exist.
    """

    __tablename__ = "threats"
    __table_args__ = (
        UniqueConstraint("tenant_id", "brand_id", "entity_id", name="uq_threat_tenant_brand_entity"),
        Index("ix_threats_tenant_level_status", "tenant_id", "risk_level", "status"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    brand_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    entity_id: Mapped[uuid.UUID] = mapped_column(nullable=False)

    risk_score: Mapped[int] = mapped_column(Integer, nullable=False)
    risk_level: Mapped[RiskLevel] = mapped_column(
        SAEnum(RiskLevel, native_enum=False, values_callable=lambda e: [m.value for m in e]),
        nullable=False,
    )
    classification: Mapped[ThreatClassification] = mapped_column(
        SAEnum(
            ThreatClassification,
            native_enum=False,
            values_callable=lambda e: [m.value for m in e],
        ),
        nullable=False,
    )
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    status: Mapped[ThreatStatus] = mapped_column(
        SAEnum(ThreatStatus, native_enum=False, values_callable=lambda e: [m.value for m in e]),
        nullable=False,
        default=ThreatStatus.OPEN,
    )

    model_version: Mapped[str] = mapped_column(String(64), nullable=False)
    risk_engine_version: Mapped[str] = mapped_column(String(32), nullable=False)
    analysis_timestamp: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)

    risk_factors: Mapped[list[RiskFactor]] = relationship(
        back_populates="threat",
        cascade="all, delete-orphan",
        order_by="RiskFactor.factor_type",
    )


class RiskFactor(Base, UUIDPrimaryKeyMixin):
    """Explainable contribution to a threat's risk score.

    Immutable per analysis run: on re-analysis the threat's factors are
    replaced wholesale so the current view always matches the latest
    AnalysisResult snapshot.
    """

    __tablename__ = "risk_factors"
    __table_args__ = (Index("ix_risk_factors_threat", "threat_id"),)

    threat_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("threats.id", ondelete="CASCADE"), nullable=False
    )
    factor_type: Mapped[FactorType] = mapped_column(
        SAEnum(FactorType, native_enum=False, values_callable=lambda e: [m.value for m in e]),
        nullable=False,
    )
    score: Mapped[int] = mapped_column(Integer, nullable=False)
    weight: Mapped[float] = mapped_column(Float, nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    basis: Mapped[EvidenceBasis] = mapped_column(
        SAEnum(EvidenceBasis, native_enum=False, values_callable=lambda e: [m.value for m in e]),
        nullable=False,
        default=EvidenceBasis.OBSERVED,
    )
    contribution: Mapped[float] = mapped_column(Float, nullable=False)
    evidence_ids: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)

    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    threat: Mapped[Threat] = relationship(back_populates="risk_factors")
