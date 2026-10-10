"""Duplicate-entity detection on create — domain match within
(tenant, entity_type) 409s instead of silently creating a second entity
(SYNTHETIC TEST_ONLY data throughout)."""
from __future__ import annotations

import uuid


class TestEntityDedup:
    def test_same_domain_same_type_conflicts(
        self, client, tenant_headers, tenant_a, make_entity
    ):
        existing = make_entity(tenant_a)
        response = client.post(
            "/api/v1/entities",
            json={
                "entity_type": "WEBSITE",
                "display_name": "Acme Support Clone",
                "identifiers": {"domain": "ACME-SUPPORT.COM"},
            },
            headers=tenant_headers(tenant_a),
        )
        assert response.status_code == 409
        body = response.json()
        assert body["error_code"] == "DUPLICATE_ENTITY"
        assert body["details"]["existing_entity_id"] == existing["entity_id"]

    def test_same_domain_different_type_allowed(
        self, client, tenant_headers, tenant_a, make_entity
    ):
        make_entity(tenant_a)
        response = client.post(
            "/api/v1/entities",
            json={
                "entity_type": "DOMAIN",
                "display_name": "Acme Support Domain Record",
                "identifiers": {"domain": "https://www.acme-support.com/login"},
            },
            headers=tenant_headers(tenant_a),
        )
        assert response.status_code == 201

    def test_entities_without_domain_not_deduped(
        self, client, tenant_headers, tenant_a
    ):
        payload = {
            "entity_type": "SOCIAL_PROFILE",
            "display_name": "Synthetic Profile",
            "identifiers": {"handle": "@same_handle"},
        }
        first = client.post(
            "/api/v1/entities", json=payload, headers=tenant_headers(tenant_a)
        )
        second = client.post(
            "/api/v1/entities", json=payload, headers=tenant_headers(tenant_a)
        )
        assert first.status_code == 201
        assert second.status_code == 201

    def test_same_domain_cross_tenant_allowed(
        self, client, tenant_headers, tenant_a, tenant_b, make_entity
    ):
        make_entity(tenant_a)
        response = client.post(
            "/api/v1/entities",
            json={
                "entity_type": "WEBSITE",
                "display_name": "Other Tenant Same Domain",
                "identifiers": {"domain": "acme-support.com"},
            },
            headers=tenant_headers(tenant_b),
        )
        assert response.status_code == 201

    def test_exact_id_replay_reports_entity_id(
        self, client, tenant_headers, tenant_a
    ):
        entity_id = uuid.uuid4()
        payload = {"entity_type": "WEBSITE", "entity_id": str(entity_id)}
        first = client.post(
            "/api/v1/entities", json=payload, headers=tenant_headers(tenant_a)
        )
        assert first.status_code == 201
        second = client.post(
            "/api/v1/entities", json=payload, headers=tenant_headers(tenant_a)
        )
        assert second.status_code == 409
        assert second.json()["details"]["entity_id"] == str(entity_id)
