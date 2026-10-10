"""Module 3 persistence — entities, evidence and source provenance.

Module 2 keeps NO copy of this data (references only); these tables are
the single source of truth for entity/evidence aggregates. Conventions
mirror Module 2: sa.Uuid PKs, UTCDateTime (naive-stored, tz-aware in
Python), JSON columns, tenant_id index for isolation queries.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, JSON, String, TypeDecorator, Uuid
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class UTCDateTime(TypeDecorator):
    """Store tz-aware UTC datetimes portably (SQLite has no native tz support)."""

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is not None and value.tzinfo is not None:
            return value.astimezone(timezone.utc).replace(tzinfo=None)
        return value

    def process_result_value(self, value, dialect):
        if value is not None and value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class SourceRecord(Base):
    """Provenance: where evidence came from. Tenant-scoped so source names
    never leak across tenants."""

    __tablename__ = "m3_sources"

    source_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    kind: Mapped[str] = mapped_column(String(100), nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)


class EntityRecord(Base):
    __tablename__ = "m3_entities"

    entity_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False, index=True)
    entity_type: Mapped[str] = mapped_column(String(48), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(300), nullable=True)
    identifiers: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    attributes: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime, default=utcnow, onupdate=utcnow, nullable=False
    )


class EvidenceRecord(Base):
    __tablename__ = "m3_evidence"

    evidence_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    source_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("m3_sources.source_id"), nullable=False
    )
    entity_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("m3_entities.entity_id"), nullable=False, index=True
    )
    evidence_type: Mapped[str] = mapped_column(String(48), nullable=False)
    collected_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    text: Mapped[str | None] = mapped_column(String, nullable=True)
    image_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
