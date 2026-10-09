"""Tests for the deterministic synthetic seeding utility.

All seeded data is SYNTHETIC TEST_ONLY — it must never be presented as
real discovery output. Seeding is idempotent (uuid5-derived ids) and
tenant-isolated.
"""
from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from module3.main import create_app
from module3.seed import SEED_NAMESPACE, seed
from module3.config import Settings

EXPECTED_EVIDENCE_TYPES = {
    "TEXT_CONTENT",
    "VISUAL_ASSET",
    "DOMAIN_INTEL",
    "BEHAVIORAL_EVENT",
}


def _client_for(engine) -> TestClient:
    app = create_app(Settings(database_url="sqlite://", _env_file=None), engine=engine)
    return TestClient(app)


class TestSeed:
    def test_creates_labelled_synthetic_bundle(self, engine, tenant_a):
        result = seed(tenant_a, engine)
        with _client_for(engine) as client:
            headers = {"X-Tenant-ID": str(tenant_a)}
            entity = client.get(f"/api/v1/entities/{result['entity_id']}", headers=headers).json()
            assert entity["identifiers"]["domain"] == "acme-support.com"
            assert entity["identifiers"]["handle"] == "acme_help"
            assert entity["attributes"]["label"] == "SYNTHETIC TEST_ONLY"

            source = client.get("/api/v1/entities/" + result["entity_id"] + "/evidence", headers=headers)
            evidence = source.json()
            assert isinstance(evidence, list) and len(evidence) == 4
            assert {item["evidence_type"] for item in evidence} == EXPECTED_EVIDENCE_TYPES
            assert "SYNTHETIC TEST_ONLY" in entity["attributes"]["label"]

    def test_ids_are_deterministic(self, engine, tenant_a):
        first = seed(tenant_a, engine)
        # uuid5 derivation: same tenant + kind → same id
        expected_entity = uuid.uuid5(SEED_NAMESPACE, f"{tenant_a}:entity")
        assert first["entity_id"] == str(expected_entity)

    def test_seed_is_idempotent(self, engine, tenant_a):
        first = seed(tenant_a, engine)
        second = seed(tenant_a, engine)
        assert first == second
        with _client_for(engine) as client:
            headers = {"X-Tenant-ID": str(tenant_a)}
            evidence = client.get(
                f"/api/v1/entities/{first['entity_id']}/evidence", headers=headers
            ).json()
            assert len(evidence) == 4  # no duplicates after re-seed

    def test_tenant_isolation(self, engine, tenant_a, tenant_b):
        bundle_a = seed(tenant_a, engine)
        seed(tenant_b, engine)
        with _client_for(engine) as client:
            headers_a = {"X-Tenant-ID": str(tenant_a)}
            evidence = client.get(
                f"/api/v1/entities/{bundle_a['entity_id']}/evidence", headers=headers_a
            ).json()
            assert len(evidence) == 4  # tenant A sees only its own bundle

            # Tenant B cannot read tenant A's entity at all.
            headers_b = {"X-Tenant-ID": str(tenant_b)}
            response = client.get(
                f"/api/v1/entities/{bundle_a['entity_id']}/evidence", headers=headers_b
            )
            assert response.status_code == 404
