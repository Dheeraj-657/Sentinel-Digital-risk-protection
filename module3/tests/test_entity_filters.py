"""GET /api/v1/entities filters — entity_type and free-text q over
display_name / domain / handle (SYNTHETIC TEST_ONLY data throughout)."""
from __future__ import annotations

import pytest


@pytest.fixture
def seeded(client, tenant_headers, tenant_a, make_entity):
    make_entity(tenant_a)  # WEBSITE "Acme Corp Support" / acme-support.com / acme_help
    make_entity(
        tenant_a,
        entity_type="SOCIAL_PROFILE",
        display_name="Acme Help Desk",
        identifiers={"handle": "@acme_helper"},
    )
    make_entity(
        tenant_a,
        entity_type="DOMAIN",
        display_name="Unrelated Telecom",
        identifiers={"domain": "unrelated-telecom.example"},
    )


class TestEntityTypeFilter:
    def test_filters_to_matching_type(self, client, tenant_headers, tenant_a, seeded):
        response = client.get(
            "/api/v1/entities",
            params={"entity_type": "WEBSITE"},
            headers=tenant_headers(tenant_a),
        )
        assert response.status_code == 200
        body = response.json()
        assert body["total"] == 1
        assert body["items"][0]["display_name"] == "Acme Corp Support"

    def test_other_type_still_listed(self, client, tenant_headers, tenant_a, seeded):
        response = client.get(
            "/api/v1/entities",
            params={"entity_type": "MOBILE_APP"},
            headers=tenant_headers(tenant_a),
        )
        assert response.status_code == 200
        assert response.json()["total"] == 0

    def test_invalid_type_rejected(self, client, tenant_headers, tenant_a, seeded):
        response = client.get(
            "/api/v1/entities",
            params={"entity_type": "SPACE_STATION"},
            headers=tenant_headers(tenant_a),
        )
        assert response.status_code == 422
        assert response.json()["error_code"] == "VALIDATION_ERROR"


class TestTextFilter:
    def test_q_matches_display_name_case_insensitive(
        self, client, tenant_headers, tenant_a, seeded
    ):
        response = client.get(
            "/api/v1/entities",
            params={"q": "ACME CORP"},
            headers=tenant_headers(tenant_a),
        )
        assert response.status_code == 200
        body = response.json()
        assert body["total"] == 1
        assert body["items"][0]["display_name"] == "Acme Corp Support"

    def test_q_matches_partial_domain(
        self, client, tenant_headers, tenant_a, seeded
    ):
        response = client.get(
            "/api/v1/entities",
            params={"q": "acme-sup"},
            headers=tenant_headers(tenant_a),
        )
        assert response.status_code == 200
        body = response.json()
        assert body["total"] == 1
        assert body["items"][0]["identifiers"]["domain"] == "acme-support.com"

    def test_q_matches_handle(
        self, client, tenant_headers, tenant_a, seeded
    ):
        response = client.get(
            "/api/v1/entities",
            params={"q": "acme_helper"},
            headers=tenant_headers(tenant_a),
        )
        assert response.status_code == 200
        body = response.json()
        assert body["total"] == 1
        assert body["items"][0]["display_name"] == "Acme Help Desk"

    def test_q_combines_with_type_filter(
        self, client, tenant_headers, tenant_a, seeded
    ):
        response = client.get(
            "/api/v1/entities",
            params={"q": "acme", "entity_type": "SOCIAL_PROFILE"},
            headers=tenant_headers(tenant_a),
        )
        assert response.status_code == 200
        body = response.json()
        assert body["total"] == 1
        assert body["items"][0]["display_name"] == "Acme Help Desk"

    def test_q_scoped_to_tenant(self, client, tenant_headers, tenant_b, seeded):
        response = client.get(
            "/api/v1/entities",
            params={"q": "acme"},
            headers=tenant_headers(tenant_b),
        )
        assert response.status_code == 200
        assert response.json()["total"] == 0
