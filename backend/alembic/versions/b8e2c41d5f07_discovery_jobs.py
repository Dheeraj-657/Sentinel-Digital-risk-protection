"""discovery jobs table

Revision ID: b8e2c41d5f07
Revises: f15fb873cb2f
Create Date: 2026-10-10

Creates discovery_jobs for the automatic threat discovery pipeline: the
Brand-DNA-derived queries, per-provider outcomes (including UNCONFIGURED /
TIMEOUT / RATE_LIMITED verdicts), the normalized candidate list, and the
Module 3 source mapping. Cross-backend types (sa.Uuid / sa.JSON /
UTCDateTime) keep the migration valid on both PostgreSQL and SQLite.
"""
from __future__ import annotations

from typing import Sequence, Union

import app.models.base
from alembic import op
import sqlalchemy as sa

revision: str = "b8e2c41d5f07"
down_revision: Union[str, None] = "f15fb873cb2f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "discovery_jobs",
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("brand_id", sa.Uuid(), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "QUEUED",
                "RUNNING",
                "COMPLETED",
                "PARTIAL",
                "FAILED",
                name="discoveryjobstatus",
                native_enum=False,
            ),
            nullable=False,
        ),
        sa.Column("queries", sa.JSON(), nullable=False),
        sa.Column("provider_outcomes", sa.JSON(), nullable=False),
        sa.Column("candidates", sa.JSON(), nullable=False),
        sa.Column("source_ids", sa.JSON(), nullable=False),
        sa.Column("duplicate_count", sa.Integer(), nullable=False),
        sa.Column("warning_message", sa.String(length=512), nullable=True),
        sa.Column("created_at", app.models.base.UTCDateTime(), nullable=False),
        sa.Column("started_at", app.models.base.UTCDateTime(), nullable=True),
        sa.Column("completed_at", app.models.base.UTCDateTime(), nullable=True),
        sa.Column("error_code", sa.String(length=64), nullable=True),
        sa.Column("error_message", sa.String(length=512), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_discovery_jobs_tenant_status",
        "discovery_jobs",
        ["tenant_id", "status"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_discovery_jobs_tenant_status", table_name="discovery_jobs")
    op.drop_table("discovery_jobs")
