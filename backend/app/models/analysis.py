from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.domain.enums import JobStatus
from app.models.base import Base, UTCDateTime, UUIDPrimaryKeyMixin, utcnow


class AnalysisJob(Base, UUIDPrimaryKeyMixin):
    __tablename__ = "analysis_jobs"
    __table_args__ = (Index("ix_analysis_jobs_tenant_status", "tenant_id", "status"),)

    tenant_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    brand_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    entity_id: Mapped[uuid.UUID] = mapped_column(nullable=False)

    status: Mapped[JobStatus] = mapped_column(
        SAEnum(JobStatus, native_enum=False, values_callable=lambda e: [m.value for m in e]),
        nullable=False,
        default=JobStatus.QUEUED,
    )
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_message: Mapped[str | None] = mapped_column(String(512), nullable=True)

    result: Mapped[AnalysisResult | None] = relationship(
        back_populates="job", cascade="all, delete-orphan", uselist=False
    )


class AnalysisResult(Base, UUIDPrimaryKeyMixin):
    """Full explainable snapshot of one analysis run (auditability)."""

    __tablename__ = "analysis_results"

    job_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("analysis_jobs.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    threat_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("threats.id", ondelete="CASCADE"), nullable=False
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(nullable=False)

    risk_score: Mapped[int] = mapped_column(Integer, nullable=False)
    risk_level: Mapped[str] = mapped_column(String(16), nullable=False)
    classification: Mapped[str] = mapped_column(String(48), nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)

    model_version: Mapped[str] = mapped_column(String(64), nullable=False)
    risk_engine_version: Mapped[str] = mapped_column(String(32), nullable=False)
    analysis_timestamp: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)

    factors: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    evidence_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)

    job: Mapped[AnalysisJob] = relationship(back_populates="result")
    evidence_references: Mapped[list[AnalysisEvidenceReference]] = relationship(
        back_populates="analysis_result",
        cascade="all, delete-orphan",
    )


class AnalysisEvidenceReference(Base, UUIDPrimaryKeyMixin):
    """Traceability link from an analysis to the Module 3 evidence it used."""

    __tablename__ = "analysis_evidence_references"
    __table_args__ = (
        UniqueConstraint("analysis_result_id", "evidence_id", name="uq_evidence_ref"),
    )

    analysis_result_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("analysis_results.id", ondelete="CASCADE"), nullable=False
    )
    evidence_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    source_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    factor_types: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)

    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)

    analysis_result: Mapped[AnalysisResult] = relationship(
        back_populates="evidence_references"
    )
