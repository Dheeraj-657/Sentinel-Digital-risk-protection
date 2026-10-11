"""module 2 initial tables

Revision ID: f15fb873cb2f
Revises:
Create Date: 2026-10-08

Creates the six Module 2 tables (threats, risk_factors, analysis_jobs,
analysis_results, analysis_evidence_references, idempotency_records).
Cross-backend types (sa.Uuid / sa.JSON / UTCDateTime) keep the migration
valid on both PostgreSQL and SQLite.
"""
from __future__ import annotations

from typing import Sequence, Union

import app.models.base
from alembic import op
import sqlalchemy as sa

revision: str = "f15fb873cb2f"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "analysis_jobs",
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("brand_id", sa.Uuid(), nullable=False),
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "QUEUED",
                "RUNNING",
                "COMPLETED",
                "FAILED",
                "CANCELLED",
                name="jobstatus",
                native_enum=False,
            ),
            nullable=False,
        ),
        sa.Column("created_at", app.models.base.UTCDateTime(), nullable=False),
        sa.Column("started_at", app.models.base.UTCDateTime(), nullable=True),
        sa.Column("completed_at", app.models.base.UTCDateTime(), nullable=True),
        sa.Column("error_code", sa.String(length=64), nullable=True),
        sa.Column("error_message", sa.String(length=512), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_analysis_jobs_tenant_status",
        "analysis_jobs",
        ["tenant_id", "status"],
        unique=False,
    )
    op.create_table(
        "threats",
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("brand_id", sa.Uuid(), nullable=False),
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column("risk_score", sa.Integer(), nullable=False),
        sa.Column(
            "risk_level",
            sa.Enum(
                "LOW",
                "MEDIUM",
                "HIGH",
                "CRITICAL",
                name="risklevel",
                native_enum=False,
            ),
            nullable=False,
        ),
        sa.Column(
            "classification",
            sa.Enum(
                "BRAND_IMPERSONATION",
                "PHISHING",
                "SUSPICIOUS_DOMAIN",
                "UNKNOWN",
                name="threatclassification",
                native_enum=False,
            ),
            nullable=False,
        ),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column(
            "status",
            sa.Enum("OPEN", "CONFIRMED", "DISMISSED", name="threatstatus", native_enum=False),
            nullable=False,
        ),
        sa.Column("model_version", sa.String(length=64), nullable=False),
        sa.Column("risk_engine_version", sa.String(length=32), nullable=False),
        sa.Column("analysis_timestamp", app.models.base.UTCDateTime(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", app.models.base.UTCDateTime(), nullable=False),
        sa.Column("updated_at", app.models.base.UTCDateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "brand_id", "entity_id", name="uq_threat_tenant_brand_entity"),
    )
    op.create_index(
        "ix_threats_tenant_level_status",
        "threats",
        ["tenant_id", "risk_level", "status"],
        unique=False,
    )
    op.create_table(
        "analysis_results",
        sa.Column("job_id", sa.Uuid(), nullable=False),
        sa.Column("threat_id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("risk_score", sa.Integer(), nullable=False),
        sa.Column("risk_level", sa.String(length=16), nullable=False),
        sa.Column("classification", sa.String(length=48), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("model_version", sa.String(length=64), nullable=False),
        sa.Column("risk_engine_version", sa.String(length=32), nullable=False),
        sa.Column("analysis_timestamp", app.models.base.UTCDateTime(), nullable=False),
        sa.Column("factors", sa.JSON(), nullable=False),
        sa.Column("evidence_count", sa.Integer(), nullable=False),
        sa.Column("created_at", app.models.base.UTCDateTime(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["job_id"], ["analysis_jobs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["threat_id"], ["threats.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("job_id"),
    )
    op.create_table(
        "idempotency_records",
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("idempotency_key", sa.String(length=255), nullable=False),
        sa.Column("request_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("job_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", app.models.base.UTCDateTime(), nullable=False),
        sa.Column("expires_at", app.models.base.UTCDateTime(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["job_id"], ["analysis_jobs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "idempotency_key", name="uq_idempotency_tenant_key"),
    )
    op.create_table(
        "risk_factors",
        sa.Column("threat_id", sa.Uuid(), nullable=False),
        sa.Column(
            "factor_type",
            sa.Enum(
                "IDENTITY_SIMILARITY",
                "TEXT_SIMILARITY",
                "VISUAL_SIMILARITY",
                "DOMAIN_SIGNALS",
                "BEHAVIORAL_SIGNALS",
                "REPUTATION_SIGNALS",
                "RELATIONSHIP_SIGNALS",
                name="factortype",
                native_enum=False,
            ),
            nullable=False,
        ),
        sa.Column("score", sa.Integer(), nullable=False),
        sa.Column("weight", sa.Float(), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column(
            "basis",
            sa.Enum(
                "OBSERVED",
                "DERIVED",
                "INFERRED",
                "PREDICTED",
                name="evidencebasis",
                native_enum=False,
            ),
            server_default="OBSERVED",
            nullable=False,
        ),
        sa.Column("contribution", sa.Float(), nullable=False),
        sa.Column("evidence_ids", sa.JSON(), nullable=False),
        sa.Column("created_at", app.models.base.UTCDateTime(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["threat_id"], ["threats.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_risk_factors_threat", "risk_factors", ["threat_id"], unique=False)
    op.create_table(
        "analysis_evidence_references",
        sa.Column("analysis_result_id", sa.Uuid(), nullable=False),
        sa.Column("evidence_id", sa.Uuid(), nullable=False),
        sa.Column("source_id", sa.Uuid(), nullable=False),
        sa.Column("factor_types", sa.JSON(), nullable=False),
        sa.Column("created_at", app.models.base.UTCDateTime(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(
            ["analysis_result_id"], ["analysis_results.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("analysis_result_id", "evidence_id", name="uq_evidence_ref"),
    )


def downgrade() -> None:
    op.drop_table("analysis_evidence_references")
    op.drop_index("ix_risk_factors_threat", table_name="risk_factors")
    op.drop_table("risk_factors")
    op.drop_table("idempotency_records")
    op.drop_table("analysis_results")
    op.drop_index("ix_threats_tenant_level_status", table_name="threats")
    op.drop_table("threats")
    op.drop_index("ix_analysis_jobs_tenant_status", table_name="analysis_jobs")
    op.drop_table("analysis_jobs")
