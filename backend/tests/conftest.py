"""Shared fixtures. ALL DATA HERE IS SYNTHETIC TEST_ONLY — no real brands,
domains, entities or evidence. The scenario mirrors the master prompt's
impersonation example (Acme Corp vs acme-support.com) with fabricated values.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 — register all tables on Base.metadata
from app.core.config import Settings
from app.domain.enums import EntityType, EvidenceType
from app.events.publisher import InMemoryEventPublisher
from app.integrations.module1.mock import MockBrandDNAClient
from app.integrations.module3.mock import MockEntityProvider, MockEvidenceProvider
from app.ml.registry import build_model_set
from app.risk.config import DEFAULT_RISK_ENGINE_CONFIG
from app.schemas.brand_dna import (
    BrandDNA,
    BrandDomain,
    BrandIdentity,
    BrandTextSignal,
    BrandVerification,
    BrandVisualAsset,
)
from app.schemas.entity import EntityReference, EvidenceReference
from app.services.evidence import EvidenceService
from app.services.risk_service import RiskService

NOW = datetime.now(timezone.utc)

# Perceptual-hash pair with a small, deliberate Hamming distance.
BRAND_LOGO_PHASH = "ff00aa55ff00aa55"
FAKE_LOGO_PHASH = "ff00aa55ff00aa57"


@pytest.fixture
def engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    import app.models.base as base_module

    base_module.Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


@pytest.fixture
def session(engine):
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    with factory() as db:
        yield db


@pytest.fixture
def settings() -> Settings:
    return Settings(worker_mode="sync", _env_file=None)


@pytest.fixture
def model_set(settings):
    return build_model_set(settings)


@pytest.fixture
def tenant_id() -> uuid.UUID:
    return uuid.uuid4()


@pytest.fixture
def brand_id() -> uuid.UUID:
    return uuid.uuid4()


@pytest.fixture
def entity_id() -> uuid.UUID:
    return uuid.uuid4()


@pytest.fixture
def source_id() -> uuid.UUID:
    return uuid.uuid4()


@pytest.fixture
def brand_dna(brand_id) -> BrandDNA:
    """SYNTHETIC TEST_ONLY brand DNA."""
    return BrandDNA(
        brand_id=brand_id,
        version="2026.10.1",
        identity=BrandIdentity(
            name="Acme Corp",
            aliases=["Acme Corporation"],
            tagline="Better things for everything",
        ),
        domains=[BrandDomain(domain="acme.com", is_primary=True)],
        visual_assets=[
            BrandVisualAsset(asset_id="logo-primary", kind="logo", content_hash=BRAND_LOGO_PHASH)
        ],
        text_signals=[
            BrandTextSignal(signal_id="tagline-1", text="Official Acme Corp support portal")
        ],
        verification=BrandVerification(verified_domains=["acme.com"]),
    )


@pytest.fixture
def entity(tenant_id, entity_id) -> EntityReference:
    """SYNTHETIC TEST_ONLY impersonating entity."""
    return EntityReference(
        entity_id=entity_id,
        tenant_id=tenant_id,
        entity_type=EntityType.WEBSITE,
        display_name="Acme Corp Support",
        identifiers={"domain": "acme-support.com", "handle": "@acme_help"},
        attributes={},
    )


@pytest.fixture
def evidence_items(entity_id, source_id) -> list[EvidenceReference]:
    """SYNTHETIC TEST_ONLY evidence bundle for the fake entity."""
    ids = [uuid.uuid4() for _ in range(4)]
    return [
        EvidenceReference(
            evidence_id=ids[0],
            source_id=source_id,
            entity_id=entity_id,
            evidence_type=EvidenceType.TEXT_CONTENT,
            collected_at=NOW,
            text="Acme Corp official support portal — verify your account now",
        ),
        EvidenceReference(
            evidence_id=ids[1],
            source_id=source_id,
            entity_id=entity_id,
            evidence_type=EvidenceType.VISUAL_ASSET,
            collected_at=NOW + timedelta(seconds=1),
            image_hash=FAKE_LOGO_PHASH,
        ),
        EvidenceReference(
            evidence_id=ids[2],
            source_id=source_id,
            entity_id=entity_id,
            evidence_type=EvidenceType.DOMAIN_INTEL,
            collected_at=NOW + timedelta(seconds=2),
            url="https://acme-support.com/login",
            metadata={"days_since_registration": 12, "whois_privacy": True},
        ),
        EvidenceReference(
            evidence_id=ids[3],
            source_id=source_id,
            entity_id=entity_id,
            evidence_type=EvidenceType.BEHAVIORAL_EVENT,
            collected_at=NOW + timedelta(seconds=3),
            metadata={"recent_account_creation": True, "brand_mimicry_in_bio": True},
        ),
    ]


@pytest.fixture
def brand_client(brand_dna):
    return MockBrandDNAClient({str(brand_dna.brand_id): brand_dna})


@pytest.fixture
def entity_provider(entity):
    return MockEntityProvider([entity])


@pytest.fixture
def evidence_provider(evidence_items):
    return MockEvidenceProvider(evidence_items)


@pytest.fixture
def risk_service() -> RiskService:
    return RiskService(DEFAULT_RISK_ENGINE_CONFIG)


@pytest.fixture
def evidence_service(evidence_provider) -> EvidenceService:
    return EvidenceService(evidence_provider, DEFAULT_RISK_ENGINE_CONFIG)


@pytest.fixture
def publisher() -> InMemoryEventPublisher:
    return InMemoryEventPublisher()
