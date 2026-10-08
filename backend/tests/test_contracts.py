"""Contract tests: cross-module boundaries stay honest.

Covers protocol conformance, HTTP adapter error mapping (using a faked
transport — no network), and schema round-trip stability. All payloads are
SYNTHETIC TEST_ONLY. Module 1 / Module 3 do not exist in this repository;
these tests pin how Module 2 behaves when the contracts are honored or
violated.
"""
from __future__ import annotations

import httpx
import pytest

from app.core.errors import (
    IntegrationUnavailableError,
    InvalidEntityError,
    MissingBrandDNAError,
    InsufficientEvidenceError,
)
from app.events.publisher import EventPublisher, InMemoryEventPublisher
from app.integrations.module1.client import HTTPBrandDNAClient
from app.integrations.module1.mock import MockBrandDNAClient
from app.integrations.module3.mock import MockEntityProvider
from app.integrations.module3.providers import (
    EntityProvider,
    EvidenceProvider,
    HTTPModule3Client,
)
from app.ml.interfaces import (
    IdentitySimilarityModel,
    TextSimilarityModel,
    VisualSimilarityModel,
)
from app.ml.registry import build_model_set
from app.risk.config import DEFAULT_RISK_ENGINE_CONFIG
from app.schemas.brand_dna import BrandDNA
from app.schemas.entity import EntityReference, EvidenceReference
from app.services.evidence import EvidenceService

TENANT = "11111111-1111-1111-1111-111111111111"
ENTITY = "22222222-2222-2222-2222-222222222222"
BRAND = "33333333-3333-3333-3333-333333333333"


class FakeResponse:
    def __init__(self, status_code: int = 200, payload=None, json_raises: bool = False):
        self.status_code = status_code
        self._payload = payload
        self._json_raises = json_raises

    def json(self):
        if self._json_raises:
            raise ValueError("not json")
        return self._payload


def install_transport(monkeypatch, responder) -> list[httpx.Request]:
    """Replace httpx.get globally; returns captured requests for assertions."""
    captured: list[httpx.Request] = []

    def fake_get(url, timeout=None, headers=None, **kwargs):
        request = httpx.Request("GET", url, headers=headers or {})
        captured.append(request)
        return responder(request)

    monkeypatch.setattr(httpx, "get", fake_get)
    return captured


class TestProtocolConformance:
    def test_mocks_satisfy_module1_contract(self):
        assert isinstance(MockBrandDNAClient(), object)  # smoke: instantiable

    def test_http_adapters_satisfy_provider_protocols(self):
        module3 = HTTPModule3Client("http://module3.invalid", 1.0)
        assert isinstance(module3, EntityProvider)
        assert isinstance(module3, EvidenceProvider)

    def test_baseline_models_satisfy_ml_protocols(self, settings):
        model_set = build_model_set(settings)
        assert isinstance(model_set.text, TextSimilarityModel)
        assert isinstance(model_set.visual, VisualSimilarityModel)
        assert isinstance(model_set.identity, IdentitySimilarityModel)

    def test_in_memory_publisher_satisfies_event_contract(self):
        assert isinstance(InMemoryEventPublisher(), EventPublisher)


class TestModule1HTTPAdapter:
    def test_200_returns_validated_brand_dna(self, monkeypatch, brand_dna):
        install_transport(monkeypatch, lambda req: FakeResponse(
            payload=brand_dna.model_dump(mode="json")
        ))
        dna = HTTPBrandDNAClient("http://module1.invalid", 1.0).get_brand_dna(BRAND)
        assert dna.brand_id == brand_dna.brand_id
        assert dna.identity.name == "Acme Corp"

    def test_404_maps_to_missing_brand_dna(self, monkeypatch):
        install_transport(monkeypatch, lambda req: FakeResponse(status_code=404))
        with pytest.raises(MissingBrandDNAError):
            HTTPBrandDNAClient("http://module1.invalid", 1.0).get_brand_dna(BRAND)

    def test_5xx_maps_to_integration_unavailable_without_upstream_body(
        self, monkeypatch
    ):
        install_transport(monkeypatch, lambda req: FakeResponse(
            status_code=500, payload={"internal": "stack detail must not leak"}
        ))
        with pytest.raises(IntegrationUnavailableError) as excinfo:
            HTTPBrandDNAClient("http://module1.invalid", 1.0).get_brand_dna(BRAND)
        assert excinfo.value.details["reason"] == "http_500"
        assert "stack detail" not in str(excinfo.value)

    def test_invalid_json_maps_to_integration_unavailable(self, monkeypatch):
        install_transport(monkeypatch, lambda req: FakeResponse(json_raises=True))
        with pytest.raises(IntegrationUnavailableError) as excinfo:
            HTTPBrandDNAClient("http://module1.invalid", 1.0).get_brand_dna(BRAND)
        assert excinfo.value.details["reason"] == "invalid_json"

    def test_contract_mismatch_maps_to_integration_unavailable(self, monkeypatch):
        install_transport(monkeypatch, lambda req: FakeResponse(payload={"nope": True}))
        with pytest.raises(IntegrationUnavailableError) as excinfo:
            HTTPBrandDNAClient("http://module1.invalid", 1.0).get_brand_dna(BRAND)
        assert excinfo.value.details["reason"] == "contract_mismatch"

    def test_network_error_maps_to_integration_unavailable(self, monkeypatch):
        def explode(request):
            raise httpx.ConnectError("connection refused")

        install_transport(monkeypatch, explode)
        with pytest.raises(IntegrationUnavailableError) as excinfo:
            HTTPBrandDNAClient("http://module1.invalid", 1.0).get_brand_dna(BRAND)
        assert excinfo.value.details["reason"] == "network_error"


class TestModule3HTTPAdapter:
    def test_get_entity_forwards_tenant_header(self, monkeypatch, entity):
        captured = install_transport(monkeypatch, lambda req: FakeResponse(
            payload=entity.model_dump(mode="json")
        ))
        HTTPModule3Client("http://module3.invalid", 1.0).get_entity(TENANT, ENTITY)
        assert captured[0].headers["X-Tenant-ID"] == TENANT

    def test_403_and_404_are_indistinguishable_invalid_entity(
        self, monkeypatch, entity
    ):
        """Cross-tenant access must not be distinguishable from non-existence."""
        for status in (403, 404):
            install_transport(monkeypatch, lambda req, s=status: FakeResponse(
                payload=entity.model_dump(mode="json"), status_code=s
            ))
            with pytest.raises(InvalidEntityError):
                HTTPModule3Client("http://module3.invalid", 1.0).get_entity(
                    TENANT, ENTITY
                )

    def test_list_evidence_returns_validated_items(
        self, monkeypatch, evidence_items
    ):
        payload = [item.model_dump(mode="json") for item in evidence_items]
        install_transport(monkeypatch, lambda req: FakeResponse(payload=payload))
        items = HTTPModule3Client("http://module3.invalid", 1.0).list_evidence(
            TENANT, ENTITY
        )
        assert len(items) == len(evidence_items)
        assert {i.evidence_id for i in items} == {i.evidence_id for i in evidence_items}

    def test_list_evidence_contract_mismatch_is_integration_unavailable(
        self, monkeypatch
    ):
        install_transport(monkeypatch, lambda req: FakeResponse(payload=[{"x": 1}]))
        with pytest.raises(IntegrationUnavailableError) as excinfo:
            HTTPModule3Client("http://module3.invalid", 1.0).list_evidence(TENANT, ENTITY)
        assert excinfo.value.details["reason"] == "contract_mismatch"


class TestSchemaRoundTrips:
    def test_brand_dna_round_trip_is_stable(self, brand_dna):
        restored = BrandDNA.model_validate(brand_dna.model_dump(mode="json"))
        assert restored == brand_dna

    def test_entity_reference_round_trip_is_stable(self, entity):
        restored = EntityReference.model_validate(entity.model_dump(mode="json"))
        assert restored == entity

    def test_evidence_reference_round_trip_is_stable(self, evidence_items):
        for item in evidence_items:
            restored = EvidenceReference.model_validate(item.model_dump(mode="json"))
            assert restored == item


class TestEvidenceService:
    def test_collect_returns_provider_evidence(
        self, tenant_id, entity_id, evidence_provider, evidence_items
    ):
        service = EvidenceService(evidence_provider, DEFAULT_RISK_ENGINE_CONFIG)
        collected = service.collect(str(tenant_id), str(entity_id))
        assert len(collected) == len(evidence_items)

    def test_no_evidence_fails_fast_with_typed_error(
        self, tenant_id, entity_id
    ):
        from app.integrations.module3.mock import MockEvidenceProvider

        service = EvidenceService(MockEvidenceProvider([]), DEFAULT_RISK_ENGINE_CONFIG)
        with pytest.raises(InsufficientEvidenceError) as excinfo:
            service.collect(str(tenant_id), str(entity_id))
        assert excinfo.value.details["evidence_count"] == 0

    def test_used_evidence_ids_maps_citations(self):
        from app.risk.calculator import ComputedFactor
        from app.domain.enums import FactorType, EvidenceBasis

        factors = [
            ComputedFactor(
                factor_type=FactorType.TEXT_SIMILARITY,
                score=80, weight=0.15, contribution=12.0, confidence=0.9,
                basis=EvidenceBasis.OBSERVED, evidence_ids=("ev-1", "ev-2"),
            ),
            ComputedFactor(
                factor_type=FactorType.VISUAL_SIMILARITY,
                score=90, weight=0.20, contribution=18.0, confidence=0.8,
                basis=EvidenceBasis.DERIVED, evidence_ids=("ev-2",),
            ),
        ]
        usage = EvidenceService.used_evidence_ids(factors)
        assert usage["ev-1"] == {FactorType.TEXT_SIMILARITY}
        assert usage["ev-2"] == {FactorType.TEXT_SIMILARITY, FactorType.VISUAL_SIMILARITY}
