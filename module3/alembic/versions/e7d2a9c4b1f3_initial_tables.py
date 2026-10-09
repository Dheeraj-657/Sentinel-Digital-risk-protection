"""module 3 initial tables

Revision ID: e7d2a9c4b1f3
Revises:
Create Date: 2026-10-09

Creates the three Module 3 tables (m3_sources, m3_entities, m3_evidence).
Cross-backend types (sa.Uuid / sa.JSON / UTCDateTime) keep the migration
valid on both PostgreSQL and SQLite. Column types match module3/models.py
exactly so future autogenerate runs produce no phantom diffs.
"""
from __future__ import annotations

from typing import Sequence, Union

import module3.models
from alembic import op
import sqlalchemy as sa

revision: str = "e7d2a9c4b1f3"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "m3_sources",
        sa.Column("source_id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("kind", sa.String(length=100), nullable=False),
        sa.Column("created_at", module3.models.UTCDateTime(), nullable=False),
        sa.PrimaryKeyConstraint("source_id"),
    )
    op.create_index("ix_m3_sources_tenant_id", "m3_sources", ["tenant_id"], unique=False)
    op.create_table(
        "m3_entities",
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("entity_type", sa.String(length=48), nullable=False),
        sa.Column("display_name", sa.String(length=300), nullable=True),
        sa.Column("identifiers", sa.JSON(), nullable=False),
        sa.Column("attributes", sa.JSON(), nullable=False),
        sa.Column("created_at", module3.models.UTCDateTime(), nullable=False),
        sa.Column("updated_at", module3.models.UTCDateTime(), nullable=False),
        sa.PrimaryKeyConstraint("entity_id"),
    )
    op.create_index("ix_m3_entities_tenant_id", "m3_entities", ["tenant_id"], unique=False)
    op.create_table(
        "m3_evidence",
        sa.Column("evidence_id", sa.Uuid(), nullable=False),
        sa.Column("source_id", sa.Uuid(), nullable=False),
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column("evidence_type", sa.String(length=48), nullable=False),
        sa.Column("collected_at", module3.models.UTCDateTime(), nullable=False),
        sa.Column("text", sa.String(), nullable=True),
        sa.Column("image_hash", sa.String(length=128), nullable=True),
        sa.Column("url", sa.String(length=2048), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("created_at", module3.models.UTCDateTime(), nullable=False),
        sa.ForeignKeyConstraint(["source_id"], ["m3_sources.source_id"]),
        sa.ForeignKeyConstraint(["entity_id"], ["m3_entities.entity_id"]),
        sa.PrimaryKeyConstraint("evidence_id"),
    )
    op.create_index("ix_m3_evidence_entity_id", "m3_evidence", ["entity_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_m3_evidence_entity_id", table_name="m3_evidence")
    op.drop_table("m3_evidence")
    op.drop_index("ix_m3_entities_tenant_id", table_name="m3_entities")
    op.drop_table("m3_entities")
    op.drop_index("ix_m3_sources_tenant_id", table_name="m3_sources")
    op.drop_table("m3_sources")
