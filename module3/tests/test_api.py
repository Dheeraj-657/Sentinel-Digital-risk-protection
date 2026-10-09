"""API tests for Module 3 — the wire contract Module 2 consumes
(SYNTHETIC TEST_ONLY data throughout)."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

ENTITY_KEYS = {
    "entity_id",
    "tenant_id",
    "entity_type",
    "display_name",
    "identifiers",
    "attributes",
}
EVIDENCE_KEYS = {
    "evidence_id",
    "source_id",
    "entity_id",
    "evidence_type",
    "collected_at",
    "text",
    "image_hash",
    "url",
    "metadata",
}


class TestHealth:
    def test_healthz(self, client):
        response = client.get("/healthz")
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "ok"
        assert body["service"] == "module3"


class TestTenantHeader:
    def test_missing_header_rejected(self, client):
        response = client.post(
            "/api/v1/entities", json={"entity_type": "WEBSITE"}
        )
        assert response.status_code == 400
        assert response.json()["error_code"] == "TENANT_REQUIRED"

    def test_invalid_uuid_header_rejected(self, client):
        response = client.post(
            "/api/v1/entities",
            json={"entity_type": "WEBSITE"},
            headers={"X-Tenant-ID": "not-a-uuid"},
        )
        assert response.status_code == 400
        assert response.json()["error_code"] == "TENANT_REQUIRED"

    def test_error_envelope_shape(self, client):
        response = client.get(f"/api/v1/entities/{uuid.uuid4()}")
        assert response.status_code == 400
        body = response.json()
        assert set(body) == {"error_code", "message", "details"}


class TestSourceIngestion:
    def test_create_source(self, client, tenant_headers, tenant_a):
        response = client.post(
            "/api/v1/sources",
            json={"name": "synthetic-test-source", "kind": "fixture"},
            headers=tenant_headers(tenant_a),
        )
        assert response.status_code == 201
        body = response.json()
        assert set(body) == {"source_id", "name", "kind", "created_at"}
        assert body["name"] == "synthetic-test-source"
        uuid.UUID(body["source_id"])

    def test_source_name_required(self, client, tenant_headers, tenant_a):
        response = client.post(
            "/api/v1/sources",
            json={"kind": "fixture"},
            headers=tenant_headers(tenant_a),
        )
        assert response.status_code == 422
        assert response.json()["error_code"] == "VALIDATION_ERROR"


class TestEntityIngestion:
    def test_create_entity_normalizes_identifiers(
        self, client, tenant_headers, tenant_a
    ):
        response = client.post(
            "/api/v1/entities",
            json={
                "entity_type": "WEBSITE",
                "display_name": "Acme Corp Support",
                "identifiers": {
                    "domain": "https://WWW.Acme-Support.com/verify",
                    "handle": "@Acme_Help",
                },
            },
            headers=tenant_headers(tenant_a),
        )
        assert response.status_code == 201
        body = response.json()
        assert body["identifiers"] == {
            "domain": "acme-support.com",
            "handle": "acme_help",
        }

    def test_create_entity_reference_shape(
        self, client, tenant_headers, tenant_a
    ):
        response = client.post(
            "/api/v1/entities",
            json={"entity_type": "WEBSITE", "display_name": "Acme Corp Support"},
            headers=tenant_headers(tenant_a),
        )
        assert response.status_code == 201
        body = response.json()
        assert set(body) == ENTITY_KEYS
        assert body["tenant_id"] == str(tenant_a)
        assert body["entity_type"] == "WEBSITE"

    def test_client_supplied_entity_id_honored(
        self, client, tenant_headers, tenant_a
    ):
        entity_id = uuid.uuid4()
        response = client.post(
            "/api/v1/entities",
            json={"entity_type": "DOMAIN", "entity_id": str(entity_id)},
            headers=tenant_headers(tenant_a),
        )
        assert response.status_code == 201
        assert response.json()["entity_id"] == str(entity_id)

    def test_duplicate_entity_id_conflicts(
        self, client, tenant_headers, tenant_a
    ):
        entity_id = uuid.uuid4()
        payload = {"entity_type": "DOMAIN", "entity_id": str(entity_id)}
        first = client.post(
            "/api/v1/entities", json=payload, headers=tenant_headers(tenant_a)
        )
        assert first.status_code == 201
        second = client.post(
            "/api/v1/entities", json=payload, headers=tenant_headers(tenant_a)
        )
        assert second.status_code == 409
        assert second.json()["error_code"] == "DUPLICATE_ENTITY"

    def test_empty_identifiers_dropped(self, client, tenant_headers, tenant_a):
        response = client.post(
            "/api/v1/entities",
            json={"entity_type": "WEBSITE", "identifiers": {"domain": "   "}},
            headers=tenant_headers(tenant_a),
        )
        assert response.status_code == 201
        assert response.json()["identifiers"] == {}

    def test_invalid_entity_type_rejected(self, client, tenant_headers, tenant_a):
        response = client.post(
            "/api/v1/entities",
            json={"entity_type": "NOT_A_TYPE"},
            headers=tenant_headers(tenant_a),
        )
        assert response.status_code == 422


class TestEntityRetrieval:
    def test_get_entity_roundtrip(self, client, tenant_headers, tenant_a, make_entity):
        created = make_entity(tenant_a)
        response = client.get(
            f"/api/v1/entities/{created['entity_id']}",
            headers=tenant_headers(tenant_a),
        )
        assert response.status_code == 200
        body = response.json()
        assert set(body) == ENTITY_KEYS
        assert body["entity_id"] == created["entity_id"]
        assert body["display_name"] == "Acme Corp Support"
        assert body["identifiers"]["domain"] == "acme-support.com"

    def test_get_missing_entity_404(self, client, tenant_headers, tenant_a):
        response = client.get(
            f"/api/v1/entities/{uuid.uuid4()}", headers=tenant_headers(tenant_a)
        )
        assert response.status_code == 404
        assert response.json()["error_code"] == "NOT_FOUND"

    def test_cross_tenant_get_indistinguishable_from_missing(
        self, client, tenant_headers, tenant_a, tenant_b, make_entity
    ):
        created = make_entity(tenant_a)
        response = client.get(
            f"/api/v1/entities/{created['entity_id']}",
            headers=tenant_headers(tenant_b),
        )
        assert response.status_code == 404
        assert response.json()["error_code"] == "NOT_FOUND"

    def test_invalid_entity_uuid_in_path_rejected(
        self, client, tenant_headers, tenant_a
    ):
        response = client.get(
            "/api/v1/entities/not-a-uuid", headers=tenant_headers(tenant_a)
        )
        assert response.status_code == 422


class TestEvidenceIngestion:
    def test_create_evidence_shape(
        self, client, tenant_headers, tenant_a, make_source, make_entity, make_evidence
    ):
        source = make_source(tenant_a)
        entity = make_entity(tenant_a)
        body = make_evidence(tenant_a, entity["entity_id"], source["source_id"])
        assert set(body) == EVIDENCE_KEYS
        assert body["entity_id"] == entity["entity_id"]
        assert body["source_id"] == source["source_id"]
        assert body["evidence_type"] == "TEXT_CONTENT"

    def test_collected_at_defaults_and_accepts_explicit(
        self, client, tenant_headers, tenant_a, make_source, make_entity, make_evidence
    ):
        source = make_source(tenant_a)
        entity = make_entity(tenant_a)
        default = make_evidence(tenant_a, entity["entity_id"], source["source_id"])
        assert datetime.fromisoformat(default["collected_at"]).tzinfo is not None
        explicit_time = "2026-10-09T12:00:00+00:00"
        explicit = make_evidence(
            tenant_a,
            entity["entity_id"],
            source["source_id"],
            collected_at=explicit_time,
        )
        assert explicit["collected_at"].startswith("2026-10-09T12:00:00")

    def test_metadata_roundtrip(
        self, client, tenant_headers, tenant_a, make_source, make_entity, make_evidence
    ):
        source = make_source(tenant_a)
        entity = make_entity(tenant_a)
        body = make_evidence(
            tenant_a,
            entity["entity_id"],
            source["source_id"],
            evidence_type="DOMAIN_INTEL",
            metadata={"days_since_registration": 12, "whois_privacy": True},
        )
        assert body["metadata"] == {
            "days_since_registration": 12,
            "whois_privacy": True,
        }

    def test_cross_tenant_entity_404(
        self, client, tenant_headers, tenant_a, tenant_b, make_source, make_entity
    ):
        source = make_source(tenant_a)
        entity = make_entity(tenant_a)
        response = client.post(
            f"/api/v1/entities/{entity['entity_id']}/evidence",
            json={"source_id": source["source_id"], "evidence_type": "TEXT_CONTENT"},
            headers=tenant_headers(tenant_b),
        )
        assert response.status_code == 404
        assert response.json()["error_code"] == "NOT_FOUND"

    def test_missing_source_404(
        self, client, tenant_headers, tenant_a, make_entity
    ):
        entity = make_entity(tenant_a)
        response = client.post(
            f"/api/v1/entities/{entity['entity_id']}/evidence",
            json={"source_id": str(uuid.uuid4()), "evidence_type": "TEXT_CONTENT"},
            headers=tenant_headers(tenant_a),
        )
        assert response.status_code == 404
        assert response.json()["error_code"] == "SOURCE_NOT_FOUND"

    def test_cross_tenant_source_404(
        self, client, tenant_headers, tenant_a, tenant_b, make_source, make_entity
    ):
        source = make_source(tenant_b)
        entity = make_entity(tenant_a)
        response = client.post(
            f"/api/v1/entities/{entity['entity_id']}/evidence",
            json={"source_id": source["source_id"], "evidence_type": "TEXT_CONTENT"},
            headers=tenant_headers(tenant_a),
        )
        assert response.status_code == 404
        assert response.json()["error_code"] == "SOURCE_NOT_FOUND"


class TestEvidenceRetrieval:
    def test_list_is_bare_json_array(
        self, client, tenant_headers, seeded_bundle
    ):
        response = client.get(
            f"/api/v1/entities/{seeded_bundle['entity_id']}/evidence",
            headers=tenant_headers(seeded_bundle["tenant_id"]),
        )
        assert response.status_code == 200
        payload = response.json()
        assert isinstance(payload, list)
        assert len(payload) == 4
        for item in payload:
            assert set(item) == EVIDENCE_KEYS

    def test_list_types_and_ordering(self, client, tenant_headers, seeded_bundle):
        response = client.get(
            f"/api/v1/entities/{seeded_bundle['entity_id']}/evidence",
            headers=tenant_headers(seeded_bundle["tenant_id"]),
        )
        items = response.json()
        assert {item["evidence_type"] for item in items} == {
            "TEXT_CONTENT",
            "VISUAL_ASSET",
            "DOMAIN_INTEL",
            "BEHAVIORAL_EVENT",
        }
        collected = [item["collected_at"] for item in items]
        assert collected == sorted(collected)

    def test_list_scoped_to_entity(
        self, client, tenant_headers, tenant_a, make_source, make_entity, make_evidence
    ):
        source = make_source(tenant_a)
        first = make_entity(tenant_a)
        second = make_entity(
            tenant_a,
            display_name="Other Site",
            identifiers={"domain": "other-site.example"},
        )
        make_evidence(tenant_a, first["entity_id"], source["source_id"])
        response = client.get(
            f"/api/v1/entities/{second['entity_id']}/evidence",
            headers=tenant_headers(tenant_a),
        )
        assert response.status_code == 200
        assert response.json() == []

    def test_list_cross_tenant_404(self, client, tenant_headers, seeded_bundle, tenant_b):
        response = client.get(
            f"/api/v1/entities/{seeded_bundle['entity_id']}/evidence",
            headers=tenant_headers(tenant_b),
        )
        assert response.status_code == 404

    def test_evidence_provenance_survives_roundtrip(
        self, client, tenant_headers, seeded_bundle
    ):
        response = client.get(
            f"/api/v1/entities/{seeded_bundle['entity_id']}/evidence",
            headers=tenant_headers(seeded_bundle["tenant_id"]),
        )
        domain_intel = [
            item for item in response.json() if item["evidence_type"] == "DOMAIN_INTEL"
        ][0]
        assert domain_intel["source_id"] == seeded_bundle["source_id"]
        assert domain_intel["url"] == "https://acme-support.com/login"
        assert domain_intel["metadata"]["days_since_registration"] == 12
