"""Related-threat relation tests (P2) — SYNTHETIC TEST_ONLY data throughout.

Relations are computed ONLY from exact stored-identifier matches (same key,
same value) between two entities of one tenant, with evidence linked by
exact domain correspondence. The mandated negative cases are proven here:
lookalike names/domains are never related, cross-tenant matches are never
related, and no graph edge or confidence is fabricated.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.domain.enums import EntityType, EvidenceType, RiskLevel, ThreatClassification, ThreatStatus
from app.main import create_app
from app.integrations.module3.mock import MockEntityProvider, MockEvidenceProvider
from app.models.threat import Threat
from app.schemas.entity import EntityReference, EvidenceReference

NOW = datetime.now(timezone.utc)


@pytest.fixture
def client(engine, settings):
    app = create_app(settings, engine=engine)
    with TestClient(app) as c:
        yield c


def make_entity(
    tenant_id: uuid.UUID,
    entity_id: uuid.UUID,
    *,
    domain: str | None = None,
    handle: str | None = None,
    display_name: str = "Acme Corp Support",
) -> EntityReference:
    identifiers: dict[str, str] = {}
    if domain:
        identifiers["domain"] = domain
    if handle:
        identifiers["handle"] = handle
    return EntityReference(
        entity_id=entity_id,
        tenant_id=tenant_id,
        entity_type=EntityType.WEBSITE,
        display_name=display_name,
        identifiers=identifiers,
        attributes={},
    )


def make_evidence(
    entity_id: uuid.UUID,
    *,
    url: str | None = None,
    metadata: dict | None = None,
    evidence_id: uuid.UUID | None = None,
) -> EvidenceReference:
    return EvidenceReference(
        evidence_id=evidence_id or uuid.uuid4(),
        source_id=uuid.uuid4(),
        entity_id=entity_id,
        evidence_type=EvidenceType.DOMAIN_INTEL,
        collected_at=NOW,
        url=url,
        metadata=metadata or {},
    )


def make_threat(db, tenant_id: uuid.UUID, entity_id: uuid.UUID) -> Threat:
    threat = Threat(
        tenant_id=tenant_id,
        brand_id=uuid.uuid4(),
        entity_id=entity_id,
        risk_score=42,
        risk_level=RiskLevel.MEDIUM,
        classification=ThreatClassification.SUSPICIOUS_DOMAIN,
        confidence=0.8,
        status=ThreatStatus.OPEN,
        model_version="synthetic-test@1.0",
        risk_engine_version="1.0.0",
        analysis_timestamp=NOW,
    )
    db.add(threat)
    db.commit()
    return threat


def bind_providers(client, entities, evidence):
    state = client.app.state
    state.entity_provider = MockEntityProvider(entities)
    state.evidence_provider = MockEvidenceProvider(evidence)


class TestRelatedThreats:
    def test_shared_domain_links_threats_with_evidence(
        self, client, session, tenant_id, entity_id
    ):
        entity_a = make_entity(tenant_id, entity_id, domain="acme-support.com",
                               handle="@acme_help")
        other_entity_id = uuid.uuid4()
        entity_b = make_entity(tenant_id, other_entity_id, domain="acme-support.com")
        evidence_b = make_evidence(other_entity_id, url="https://acme-support.com/login")
        threat_a = make_threat(session, tenant_id, entity_id)
        threat_b = make_threat(session, tenant_id, other_entity_id)
        bind_providers(client, [entity_a, entity_b], [evidence_b])

        response = client.get(
            f"{client.app.state.settings.api_v1_prefix}"
            f"/threats/{threat_a.id}/related",
            headers={"X-Tenant-ID": str(tenant_id)},
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["total"] == 1
        item = body["items"][0]
        assert item["threat_id"] == str(threat_b.id)
        assert item["relation_type"] == "SHARED_DOMAIN"
        assert item["basis"] == "EXACT_ATTRIBUTE_MATCH"
        assert item["shared_attribute"] == {"key": "domain", "value": "acme-support.com"}
        assert item["evidence_ids"] == [str(evidence_b.evidence_id)]
        assert item["target_evidence_ids"] == []

    def test_lookalike_domain_is_never_related(self, client, session, tenant_id, entity_id):
        entity_a = make_entity(tenant_id, entity_id, domain="acme-support.com")
        other_id = uuid.uuid4()
        entity_b = make_entity(tenant_id, other_id, domain="acme-supp0rt.com")
        threat_a = make_threat(session, tenant_id, entity_id)
        make_threat(session, tenant_id, other_id)
        bind_providers(client, [entity_a, entity_b], [])

        response = client.get(
            f"{client.app.state.settings.api_v1_prefix}/threats/{threat_a.id}/related",
            headers={"X-Tenant-ID": str(tenant_id)},
        )

        assert response.status_code == 200
        body = response.json()
        assert body["total"] == 0
        assert body["items"] == []

    def test_same_display_name_is_never_related(self, client, session, tenant_id, entity_id):
        entity_a = make_entity(tenant_id, entity_id, domain="acme-support.com",
                               display_name="Acme Corp Support")
        other_id = uuid.uuid4()
        entity_b = make_entity(tenant_id, other_id, domain="totally-other.net",
                               display_name="Acme Corp Support")
        threat_a = make_threat(session, tenant_id, entity_id)
        make_threat(session, tenant_id, other_id)
        bind_providers(client, [entity_a, entity_b], [])

        response = client.get(
            f"{client.app.state.settings.api_v1_prefix}/threats/{threat_a.id}/related",
            headers={"X-Tenant-ID": str(tenant_id)},
        )

        body = response.json()
        assert body["total"] == 0

    def test_cross_tenant_same_domain_is_never_related(
        self, client, session, tenant_id, entity_id
    ):
        other_tenant = uuid.uuid4()
        entity_a = make_entity(tenant_id, entity_id, domain="acme-support.com")
        other_id = uuid.uuid4()
        entity_b = make_entity(other_tenant, other_id, domain="acme-support.com")
        threat_a = make_threat(session, tenant_id, entity_id)
        make_threat(session, other_tenant, other_id)
        bind_providers(client, [entity_a, entity_b], [])

        response = client.get(
            f"{client.app.state.settings.api_v1_prefix}/threats/{threat_a.id}/related",
            headers={"X-Tenant-ID": str(tenant_id)},
        )

        body = response.json()
        # entity_b belongs to another tenant; the relation lookup must not
        # even be able to see it.
        assert body["total"] == 0

    def test_shared_handle_is_a_shared_identifier(
        self, client, session, tenant_id, entity_id
    ):
        entity_a = make_entity(tenant_id, entity_id, domain="acme-support.com",
                               handle="@acme_help")
        other_id = uuid.uuid4()
        entity_b = make_entity(tenant_id, other_id, domain="other-site.org",
                               handle="@acme_help")
        threat_a = make_threat(session, tenant_id, entity_id)
        threat_b = make_threat(session, tenant_id, other_id)
        bind_providers(client, [entity_a, entity_b], [])

        response = client.get(
            f"{client.app.state.settings.api_v1_prefix}/threats/{threat_a.id}/related",
            headers={"X-Tenant-ID": str(tenant_id)},
        )

        body = response.json()
        assert body["total"] == 1
        item = body["items"][0]
        assert item["threat_id"] == str(threat_b.id)
        assert item["relation_type"] == "SHARED_IDENTIFIER"
        assert item["shared_attribute"] == {"key": "handle", "value": "@acme_help"}

    def test_subdomain_is_not_an_exact_match(self, client, session, tenant_id, entity_id):
        entity_a = make_entity(tenant_id, entity_id, domain="acme-support.com")
        other_id = uuid.uuid4()
        entity_b = make_entity(tenant_id, other_id, domain="portal.acme-support.com")
        threat_a = make_threat(session, tenant_id, entity_id)
        make_threat(session, tenant_id, other_id)
        bind_providers(client, [entity_a, entity_b], [])

        response = client.get(
            f"{client.app.state.settings.api_v1_prefix}/threats/{threat_a.id}/related",
            headers={"X-Tenant-ID": str(tenant_id)},
        )

        body = response.json()
        assert body["total"] == 0

    def test_evidence_links_require_domain_correspondence(
        self, client, session, tenant_id, entity_id
    ):
        entity_a = make_entity(tenant_id, entity_id, domain="acme-support.com")
        other_id = uuid.uuid4()
        entity_b = make_entity(tenant_id, other_id, domain="acme-support.com")
        unrelated = make_evidence(other_id, url="https://unrelated-example.com/x")
        threat_a = make_threat(session, tenant_id, entity_id)
        threat_b = make_threat(session, tenant_id, other_id)
        bind_providers(client, [entity_a, entity_b], [unrelated])

        response = client.get(
            f"{client.app.state.settings.api_v1_prefix}/threats/{threat_a.id}/related",
            headers={"X-Tenant-ID": str(tenant_id)},
        )

        body = response.json()
        # The exact shared domain still relates the threats; the unrelated
        # evidence is NOT claimed as supporting the relation.
        assert body["total"] == 1
        assert body["items"][0]["evidence_ids"] == []

    def test_unknown_threat_returns_404(self, client, tenant_id):
        response = client.get(
            f"{client.app.state.settings.api_v1_prefix}"
            f"/threats/{uuid.uuid4()}/related",
            headers={"X-Tenant-ID": str(tenant_id)},
        )
        assert response.status_code == 404
        body = response.json()
        assert body["error_code"] == "NOT_FOUND"

    def test_no_other_threats_returns_empty_items(
        self, client, session, tenant_id, entity_id
    ):
        entity_a = make_entity(tenant_id, entity_id, domain="acme-support.com")
        threat_a = make_threat(session, tenant_id, entity_id)
        bind_providers(client, [entity_a], [])

        response = client.get(
            f"{client.app.state.settings.api_v1_prefix}/threats/{threat_a.id}/related",
            headers={"X-Tenant-ID": str(tenant_id)},
        )

        assert response.status_code == 200
        body = response.json()
        assert body["total"] == 0
        assert body["items"] == []
