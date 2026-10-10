"""Module 3 API — the wire contract Module 2's HTTPModule3Client expects.

Endpoints (all under /api/v1, all requiring the X-Tenant-ID header — the
same provisional tenant mechanism Module 2 uses):

  POST /sources                        register a provenance source
  POST /entities                       register an entity (normalized identifiers)
  GET  /entities/{entity_id}           EntityReference view (Module 2 consumes)
  POST /entities/{entity_id}/evidence  attach evidence with provenance
  GET  /entities/{entity_id}/evidence  bare JSON list (Module 2 consumes)

Cross-tenant access is indistinguishable from "not found" (404) — the same
semantics Module 2's client maps to InvalidEntityError.
"""
from __future__ import annotations

import uuid
from collections.abc import Iterator
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query, Request, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from module3 import schemas
from module3.errors import AppError, ErrorCode
from module3.models import EntityRecord, EvidenceRecord, SourceRecord, utcnow
from module3.normalization import normalize_identifiers

router = APIRouter(prefix="/api/v1")


def get_db(request: Request) -> Iterator[Session]:
    session = request.app.state.session_factory()
    try:
        yield session
    finally:
        session.close()


DbDep = Annotated[Session, Depends(get_db)]


def require_tenant(
    x_tenant_id: Annotated[str | None, Header(alias="X-Tenant-ID")] = None,
) -> uuid.UUID:
    if not x_tenant_id:
        raise AppError(
            ErrorCode.TENANT_REQUIRED,
            "X-Tenant-ID header is required.",
            http_status=400,
        )
    try:
        return uuid.UUID(x_tenant_id)
    except ValueError:
        raise AppError(
            ErrorCode.TENANT_REQUIRED,
            "X-Tenant-ID must be a UUID.",
            http_status=400,
        ) from None


TenantDep = Annotated[uuid.UUID, Depends(require_tenant)]


def _entity_reference(record: EntityRecord) -> schemas.EntityReference:
    return schemas.EntityReference(
        entity_id=record.entity_id,
        tenant_id=record.tenant_id,
        entity_type=schemas.EntityType(record.entity_type),
        display_name=record.display_name,
        identifiers=dict(record.identifiers or {}),
        attributes=dict(record.attributes or {}),
    )


def _evidence_reference(record: EvidenceRecord) -> schemas.EvidenceReference:
    return schemas.EvidenceReference(
        evidence_id=record.evidence_id,
        source_id=record.source_id,
        entity_id=record.entity_id,
        evidence_type=schemas.EvidenceType(record.evidence_type),
        collected_at=record.collected_at,
        text=record.text,
        image_hash=record.image_hash,
        url=record.url,
        metadata=dict(record.metadata_json or {}),
    )


def _entity_list_item(record: EntityRecord) -> schemas.EntityListItem:
    return schemas.EntityListItem(
        entity_id=record.entity_id,
        tenant_id=record.tenant_id,
        entity_type=schemas.EntityType(record.entity_type),
        display_name=record.display_name,
        identifiers=dict(record.identifiers or {}),
        attributes=dict(record.attributes or {}),
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


def _get_entity(db: Session, tenant_id: uuid.UUID, entity_id: uuid.UUID) -> EntityRecord:
    record = db.get(EntityRecord, entity_id)
    if record is None or record.tenant_id != tenant_id:
        raise AppError(
            ErrorCode.NOT_FOUND,
            f"Entity '{entity_id}' was not found.",
            http_status=404,
            details={"entity_id": str(entity_id)},
        )
    return record


def _get_source(db: Session, tenant_id: uuid.UUID, source_id: uuid.UUID) -> SourceRecord:
    record = db.get(SourceRecord, source_id)
    if record is None or record.tenant_id != tenant_id:
        raise AppError(
            ErrorCode.SOURCE_NOT_FOUND,
            f"Source '{source_id}' was not found.",
            http_status=404,
            details={"source_id": str(source_id)},
        )
    return record


@router.post(
    "/sources",
    response_model=schemas.SourceReference,
    status_code=status.HTTP_201_CREATED,
)
def create_source(
    payload: schemas.SourceCreate, db: DbDep, tenant: TenantDep
) -> schemas.SourceReference:
    record = SourceRecord(tenant_id=tenant, name=payload.name, kind=payload.kind)
    db.add(record)
    db.commit()
    db.refresh(record)
    return schemas.SourceReference(
        source_id=record.source_id,
        name=record.name,
        kind=record.kind,
        created_at=record.created_at,
    )


@router.get("/sources", response_model=schemas.SourceListResponse)
def list_sources(
    db: DbDep,
    tenant: TenantDep,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> schemas.SourceListResponse:
    """Tenant-scoped source list so the console can show provenance names
    for evidence references (which carry only source_id)."""
    total = (
        db.scalar(
            select(func.count())
            .select_from(SourceRecord)
            .where(SourceRecord.tenant_id == tenant)
        )
        or 0
    )
    records = db.scalars(
        select(SourceRecord)
        .where(SourceRecord.tenant_id == tenant)
        .order_by(SourceRecord.created_at.desc(), SourceRecord.source_id)
        .limit(limit)
        .offset(offset)
    ).all()
    return schemas.SourceListResponse(
        items=[
            schemas.SourceReference(
                source_id=record.source_id,
                name=record.name,
                kind=record.kind,
                created_at=record.created_at,
            )
            for record in records
        ],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post(
    "/entities",
    response_model=schemas.EntityReference,
    status_code=status.HTTP_201_CREATED,
)
def create_entity(
    payload: schemas.EntityCreate, db: DbDep, tenant: TenantDep
) -> schemas.EntityReference:
    entity_id = payload.entity_id or uuid.uuid4()
    if db.get(EntityRecord, entity_id) is not None:
        raise AppError(
            ErrorCode.DUPLICATE_ENTITY,
            f"Entity '{entity_id}' already exists.",
            http_status=409,
            details={"entity_id": str(entity_id)},
        )
    normalized = normalize_identifiers(payload.identifiers)
    domain_key = normalized.get("domain")
    if domain_key:
        conflict_id = db.scalars(
            select(EntityRecord.entity_id)
            .where(
                EntityRecord.tenant_id == tenant,
                EntityRecord.entity_type == payload.entity_type.value,
                EntityRecord.identifiers["domain"].as_string() == domain_key,
            )
            .limit(1)
        ).first()
        if conflict_id is not None:
            raise AppError(
                ErrorCode.DUPLICATE_ENTITY,
                f"An entity with domain '{domain_key}' already exists for this "
                "tenant and type.",
                http_status=409,
                details={"existing_entity_id": str(conflict_id)},
            )
    record = EntityRecord(
        entity_id=entity_id,
        tenant_id=tenant,
        entity_type=payload.entity_type.value,
        display_name=payload.display_name,
        identifiers=normalized,
        attributes=dict(payload.attributes),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return _entity_reference(record)


@router.get("/entities", response_model=schemas.EntityListResponse)
def list_entities(
    db: DbDep,
    tenant: TenantDep,
    entity_type: schemas.EntityType | None = Query(default=None),
    q: Annotated[str | None, Query(max_length=200)] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> schemas.EntityListResponse:
    """Tenant-scoped entity list for the console UI, newest first, with
    optional entity_type and free-text filters. Module 2 never calls this —
    it fetches entities by ID only."""
    conditions = [EntityRecord.tenant_id == tenant]
    if entity_type is not None:
        conditions.append(EntityRecord.entity_type == entity_type.value)
    if q:
        pattern = f"%{q.lower()}%"
        conditions.append(
            or_(
                func.lower(EntityRecord.display_name).like(pattern),
                func.lower(EntityRecord.identifiers["domain"].as_string()).like(
                    pattern
                ),
                func.lower(EntityRecord.identifiers["handle"].as_string()).like(
                    pattern
                ),
            )
        )
    total = (
        db.scalar(
            select(func.count()).select_from(EntityRecord).where(*conditions)
        )
        or 0
    )
    records = db.scalars(
        select(EntityRecord)
        .where(*conditions)
        .order_by(EntityRecord.created_at.desc(), EntityRecord.entity_id)
        .limit(limit)
        .offset(offset)
    ).all()
    return schemas.EntityListResponse(
        items=[_entity_list_item(record) for record in records],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/entities/{entity_id}", response_model=schemas.EntityReference)
def get_entity(entity_id: uuid.UUID, db: DbDep, tenant: TenantDep) -> schemas.EntityReference:
    return _entity_reference(_get_entity(db, tenant, entity_id))


@router.patch("/entities/{entity_id}", response_model=schemas.EntityListItem)
def update_entity(
    entity_id: uuid.UUID,
    payload: schemas.EntityUpdate,
    db: DbDep,
    tenant: TenantDep,
) -> schemas.EntityListItem:
    record = _get_entity(db, tenant, entity_id)
    if payload.display_name is not None:
        record.display_name = payload.display_name
    if payload.identifiers is not None:
        record.identifiers = normalize_identifiers(payload.identifiers)
    if payload.attributes is not None:
        record.attributes = dict(payload.attributes)
    db.commit()
    db.refresh(record)
    return _entity_list_item(record)


@router.post(
    "/entities/{entity_id}/evidence",
    response_model=schemas.EvidenceReference,
    status_code=status.HTTP_201_CREATED,
)
def create_evidence(
    entity_id: uuid.UUID,
    payload: schemas.EvidenceCreate,
    db: DbDep,
    tenant: TenantDep,
) -> schemas.EvidenceReference:
    entity = _get_entity(db, tenant, entity_id)
    _get_source(db, tenant, payload.source_id)
    record = EvidenceRecord(
        source_id=payload.source_id,
        entity_id=entity.entity_id,
        evidence_type=payload.evidence_type.value,
        collected_at=payload.collected_at or utcnow(),
        text=payload.text,
        image_hash=payload.image_hash,
        url=payload.url,
        metadata_json=dict(payload.metadata),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return _evidence_reference(record)


@router.get(
    "/entities/{entity_id}/evidence", response_model=list[schemas.EvidenceReference]
)
def list_evidence(
    entity_id: uuid.UUID, db: DbDep, tenant: TenantDep
) -> list[schemas.EvidenceReference]:
    entity = _get_entity(db, tenant, entity_id)
    records = db.scalars(
        select(EvidenceRecord)
        .where(EvidenceRecord.entity_id == entity.entity_id)
        .order_by(EvidenceRecord.collected_at, EvidenceRecord.evidence_id)
    ).all()
    return [_evidence_reference(record) for record in records]
