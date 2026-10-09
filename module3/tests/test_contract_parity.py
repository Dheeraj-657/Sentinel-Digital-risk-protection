"""Contract parity — Module 3 wire format vs Module 2 consumer schemas.

This module is SKIPPED ENTIRELY unless Module 2's `app` package is
importable in this interpreter. It exists purely as a test-time gate:
both services share a venv in this repo layout, so drift between
module3's serialization and Module 2's pydantic contracts is caught
here instead of in production. There is NO runtime dependency of
module3 on app — module3 never imports `app` outside this file.
"""
from __future__ import annotations

import pytest

pytest.importorskip("app")

from app.domain.enums import EntityType as M2EntityType  # noqa: E402
from app.domain.enums import EvidenceType as M2EvidenceType  # noqa: E402
from app.schemas.entity import EntityReference as M2EntityReference  # noqa: E402
from app.schemas.entity import EvidenceReference as M2EvidenceReference  # noqa: E402

from module3.schemas import EntityType as M3EntityType  # noqa: E402
from module3.schemas import EvidenceType as M3EvidenceType  # noqa: E402


class TestEnumParity:
    """M3 owns mirrored enums; value sets must match M2's exactly."""

    def test_entity_type_values_match(self):
        assert {e.value for e in M3EntityType} == {e.value for e in M2EntityType}

    def test_evidence_type_values_match(self):
        assert {e.value for e in M3EvidenceType} == {e.value for e in M2EvidenceType}


class TestWireFormatParity:
    """M3's actual HTTP JSON must validate against M2's real schemas."""

    def test_entity_json_validates_against_m2_schema(
        self, client, tenant_headers, make_entity, tenant_a
    ):
        entity = make_entity(tenant_a)
        response = client.get(f"/api/v1/entities/{entity['entity_id']}", headers=tenant_headers(tenant_a))
        assert response.status_code == 200
        m2_entity = M2EntityReference.model_validate(response.json())
        assert str(m2_entity.entity_id) == entity["entity_id"]
        assert m2_entity.identifiers["domain"] == "acme-support.com"

    def test_evidence_list_json_validates_against_m2_schema(
        self, client, tenant_headers, seeded_bundle
    ):
        response = client.get(
            f"/api/v1/entities/{seeded_bundle['entity_id']}/evidence",
            headers=tenant_headers(seeded_bundle["tenant_id"]),
        )
        assert response.status_code == 200
        payload = response.json()
        assert isinstance(payload, list) and len(payload) == 4
        for item in payload:
            m2_evidence = M2EvidenceReference.model_validate(item)
            assert m2_evidence.source_id is not None
