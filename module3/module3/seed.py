"""Seed SYNTHETIC TEST_ONLY fixtures into the Module 3 database.

ALL DATA IS SYNTHETIC — it mirrors Module 2's documented impersonation
example (Acme Corp vs acme-support.com) and the evidence metadata keys
Module 2's risk engine reads. No live discovery results are invented;
live sources are unavailable, so fixtures are clearly labelled.

Usage:
    python -m module3.seed <tenant-uuid>

Requires the schema first:  alembic upgrade head
"""
from __future__ import annotations

import argparse
import json
import sys
import uuid

from sqlalchemy.exc import OperationalError

from module3.config import get_settings
from module3.database import build_engine, build_session_factory
from module3.models import EntityRecord, EvidenceRecord, SourceRecord, utcnow

SEED_NAMESPACE = uuid.uuid5(uuid.NAMESPACE_DNS, "trustgraph.module3.seed")

SYNTHETIC_LABEL = "SYNTHETIC TEST_ONLY"


def _seed_id(tenant_id: uuid.UUID, kind: str) -> uuid.UUID:
    return uuid.uuid5(SEED_NAMESPACE, f"{tenant_id}:{kind}")


_EVIDENCE_SPECS = [
    (
        "evidence_text",
        "TEXT_CONTENT",
        {"text": "Acme Corp official support portal — verify your account now"},
    ),
    ("evidence_visual", "VISUAL_ASSET", {"image_hash": "ff00aa55ff00aa57"}),
    (
        "evidence_domain",
        "DOMAIN_INTEL",
        {
            "url": "https://acme-support.com/login",
            "metadata": {"days_since_registration": 12, "whois_privacy": True},
        },
    ),
    (
        "evidence_behavior",
        "BEHAVIORAL_EVENT",
        {"metadata": {"recent_account_creation": True, "brand_mimicry_in_bio": True}},
    ),
]


def seed(tenant_id: uuid.UUID, engine) -> dict:
    """Idempotent: fixed uuid5 ids make re-runs no-ops. Returns fixture ids."""
    source_id = _seed_id(tenant_id, "source")
    entity_id = _seed_id(tenant_id, "entity")
    now = utcnow()
    with build_session_factory(engine)() as db:
        if db.get(EntityRecord, entity_id) is None:
            if db.get(SourceRecord, source_id) is None:
                db.add(
                    SourceRecord(
                        source_id=source_id,
                        tenant_id=tenant_id,
                        name=f"synthetic-fixture-source ({SYNTHETIC_LABEL})",
                        kind="fixture",
                    )
                )
            db.add(
                EntityRecord(
                    entity_id=entity_id,
                    tenant_id=tenant_id,
                    entity_type="WEBSITE",
                    display_name="Acme Corp Support",
                    identifiers={"domain": "acme-support.com", "handle": "acme_help"},
                    attributes={"label": SYNTHETIC_LABEL},
                )
            )
            for kind, evidence_type, fields in _EVIDENCE_SPECS:
                db.add(
                    EvidenceRecord(
                        evidence_id=_seed_id(tenant_id, kind),
                        source_id=source_id,
                        entity_id=entity_id,
                        evidence_type=evidence_type,
                        collected_at=now,
                        text=fields.get("text"),
                        image_hash=fields.get("image_hash"),
                        url=fields.get("url"),
                        metadata_json=dict(fields.get("metadata") or {}),
                    )
                )
            db.commit()
    return {
        "tenant_id": str(tenant_id),
        "source_id": str(source_id),
        "entity_id": str(entity_id),
        "label": SYNTHETIC_LABEL,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Seed SYNTHETIC TEST_ONLY fixtures into Module 3."
    )
    parser.add_argument("tenant_id", help="tenant UUID to seed fixtures for")
    args = parser.parse_args(argv)
    try:
        tenant_id = uuid.UUID(args.tenant_id)
    except ValueError:
        print(f"error: tenant id must be a UUID, got {args.tenant_id!r}", file=sys.stderr)
        return 2
    settings = get_settings()
    engine = build_engine(settings.database_url)
    try:
        result = seed(tenant_id, engine)
    except OperationalError:
        print(
            "error: database is not initialized — run `alembic upgrade head` first",
            file=sys.stderr,
        )
        return 1
    finally:
        engine.dispose()
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
