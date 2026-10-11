"""PATCH /api/v1/entities/{entity_id} — partial entity update
(SYNTHETIC TEST_ONLY data throughout)."""
from __future__ import annotations

import uuid

ENTITY_DETAIL_KEYS = {
    "entity_id",
    "tenant_id",
    "entity_type",
    "display_name",
    "identifiers",
    "attributes",
    "created_at",
    "updated_at",
}


class TestEntityUpdate:
    def test_update_display_name_and_identifiers(
        self, client, tenant_headers, tenant_a, make_entity
    ):
        created = make_entity(tenant_a)
        response = client.patch(
            f"/api/v1/entities/{created['entity_id']}",
            json={
                "display_name": "Synthetic Impersonator Two",
                "identifiers": {
                    "domain": "https://WWW.Synthetic-Two.example/verify",
                    "handle": "@Synthetic_Two",
                },
            },
            headers=tenant_headers(tenant_a),
        )
        assert response.status_code == 200
        body = response.json()
        assert set(body) == ENTITY_DETAIL_KEYS
        assert body["display_name"] == "Synthetic Impersonator Two"
        assert body["identifiers"]["domain"] == "synthetic-two.example"
        assert body["identifiers"]["handle"] == "synthetic_two"

    def test_partial_update_leaves_other_fields(
        self, client, tenant_headers, tenant_a, make_entity
    ):
        created = make_entity(tenant_a)
        response = client.patch(
            f"/api/v1/entities/{created['entity_id']}",
            json={"display_name": "Renamed Support Site"},
            headers=tenant_headers(tenant_a),
        )
        assert response.status_code == 200
        body = response.json()
        assert body["display_name"] == "Renamed Support Site"
        assert body["identifiers"]["domain"] == "acme-support.com"
        assert body["identifiers"]["handle"] == "acme_help"

    def test_empty_body_is_a_noop(self, client, tenant_headers, tenant_a, make_entity):
        created = make_entity(tenant_a)
        response = client.patch(
            f"/api/v1/entities/{created['entity_id']}",
            json={},
            headers=tenant_headers(tenant_a),
        )
        assert response.status_code == 200
        assert response.json()["display_name"] == "Acme Corp Support"

    def test_update_bumps_updated_at(
        self, client, tenant_headers, tenant_a, make_entity
    ):
        created = make_entity(tenant_a)
        before = client.get(
            "/api/v1/entities", headers=tenant_headers(tenant_a)
        ).json()["items"][0]
        assert before["entity_id"] == created["entity_id"]
        response = client.patch(
            f"/api/v1/entities/{created['entity_id']}",
            json={"display_name": "Renamed Support Site"},
            headers=tenant_headers(tenant_a),
        )
        assert response.status_code == 200
        after = client.get(
            "/api/v1/entities", headers=tenant_headers(tenant_a)
        ).json()["items"][0]
        assert after["updated_at"] > before["updated_at"]

    def test_entity_type_immutable(
        self, client, tenant_headers, tenant_a, make_entity
    ):
        created = make_entity(tenant_a)
        response = client.patch(
            f"/api/v1/entities/{created['entity_id']}",
            json={"entity_type": "SOCIAL_PROFILE"},
            headers=tenant_headers(tenant_a),
        )
        assert response.status_code == 422
        assert response.json()["error_code"] == "VALIDATION_ERROR"
        fetched = client.get(
            f"/api/v1/entities/{created['entity_id']}",
            headers=tenant_headers(tenant_a),
        )
        assert fetched.json()["entity_type"] == "WEBSITE"

    def test_blank_display_name_rejected(
        self, client, tenant_headers, tenant_a, make_entity
    ):
        created = make_entity(tenant_a)
        response = client.patch(
            f"/api/v1/entities/{created['entity_id']}",
            json={"display_name": "   "},
            headers=tenant_headers(tenant_a),
        )
        assert response.status_code == 422
        assert response.json()["error_code"] == "VALIDATION_ERROR"

    def test_unknown_entity_404(self, client, tenant_headers, tenant_a):
        response = client.patch(
            f"/api/v1/entities/{uuid.uuid4()}",
            json={"display_name": "Ghost Site"},
            headers=tenant_headers(tenant_a),
        )
        assert response.status_code == 404
        assert response.json()["error_code"] == "NOT_FOUND"

    def test_cross_tenant_patch_404_and_untouched(
        self, client, tenant_headers, tenant_a, tenant_b, make_entity
    ):
        created = make_entity(tenant_a)
        response = client.patch(
            f"/api/v1/entities/{created['entity_id']}",
            json={"display_name": "Hostile Takeover"},
            headers=tenant_headers(tenant_b),
        )
        assert response.status_code == 404
        assert response.json()["error_code"] == "NOT_FOUND"
        original = client.get(
            f"/api/v1/entities/{created['entity_id']}",
            headers=tenant_headers(tenant_a),
        )
        assert original.json()["display_name"] == "Acme Corp Support"
