"""Shared fixtures. ALL DATA IS SYNTHETIC TEST_ONLY — no real brands,
domains, entities or evidence anywhere in this suite."""
from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from module3.config import Settings
from module3.main import create_app
from module3.models import Base


@pytest.fixture
def engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


@pytest.fixture
def app(engine):
    settings = Settings(database_url="sqlite://", _env_file=None)
    return create_app(settings, engine=engine)


@pytest.fixture
def client(app):
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def tenant_a() -> uuid.UUID:
    return uuid.uuid4()


@pytest.fixture
def tenant_b() -> uuid.UUID:
    return uuid.uuid4()


@pytest.fixture
def tenant_headers():
    def _headers(tenant_id: uuid.UUID) -> dict[str, str]:
        return {"X-Tenant-ID": str(tenant_id)}

    return _headers


@pytest.fixture
def make_source(client, tenant_headers):
    def _make(tenant_id: uuid.UUID, **overrides) -> dict:
        payload = {"name": "synthetic-test-source", "kind": "fixture", **overrides}
        response = client.post(
            "/api/v1/sources", json=payload, headers=tenant_headers(tenant_id)
        )
        assert response.status_code == 201, response.text
        return response.json()

    return _make


@pytest.fixture
def make_entity(client, tenant_headers):
    def _make(tenant_id: uuid.UUID, **overrides) -> dict:
        payload = {
            "entity_type": "WEBSITE",
            "display_name": "Acme Corp Support",
            "identifiers": {"domain": "acme-support.com", "handle": "@acme_help"},
            "attributes": {},
            **overrides,
        }
        response = client.post(
            "/api/v1/entities", json=payload, headers=tenant_headers(tenant_id)
        )
        assert response.status_code == 201, response.text
        return response.json()

    return _make


@pytest.fixture
def make_evidence(client, tenant_headers):
    def _make(
        tenant_id: uuid.UUID, entity_id: str, source_id: str, **overrides
    ) -> dict:
        payload = {
            "source_id": source_id,
            "evidence_type": "TEXT_CONTENT",
            "text": "Acme Corp official support portal — verify your account now",
            **overrides,
        }
        response = client.post(
            f"/api/v1/entities/{entity_id}/evidence",
            json=payload,
            headers=tenant_headers(tenant_id),
        )
        assert response.status_code == 201, response.text
        return response.json()

    return _make


@pytest.fixture
def seeded_bundle(make_source, make_entity, make_evidence):
    """SYNTHETIC TEST_ONLY bundle mirroring module3.seed's fixtures:
    one source, one impersonating website entity, four evidence items
    carrying the metadata keys Module 2's risk engine reads."""
    tenant_id = uuid.uuid4()
    source = make_source(tenant_id)
    entity = make_entity(tenant_id)
    make_evidence(
        tenant_id,
        entity["entity_id"],
        source["source_id"],
        evidence_type="TEXT_CONTENT",
        text="Acme Corp official support portal — verify your account now",
    )
    make_evidence(
        tenant_id,
        entity["entity_id"],
        source["source_id"],
        evidence_type="VISUAL_ASSET",
        image_hash="ff00aa55ff00aa57",
    )
    make_evidence(
        tenant_id,
        entity["entity_id"],
        source["source_id"],
        evidence_type="DOMAIN_INTEL",
        url="https://acme-support.com/login",
        metadata={"days_since_registration": 12, "whois_privacy": True},
    )
    make_evidence(
        tenant_id,
        entity["entity_id"],
        source["source_id"],
        evidence_type="BEHAVIORAL_EVENT",
        metadata={"recent_account_creation": True, "brand_mimicry_in_bio": True},
    )
    return {
        "tenant_id": tenant_id,
        "source_id": source["source_id"],
        "entity_id": entity["entity_id"],
    }
