"""Integration tests: Sentinel DRP adapter (real Module 1 implementation).

Sentinel is the teammate's Next.js Module 1 service. These tests pin the
adapter against Sentinel's ACTUAL wire contract using a faked httpx
transport — no network, no running Sentinel. All payloads are SYNTHETIC
TEST_ONLY and mirror Sentinel's documented shapes
(GET /api/brands -> {"items": [...]}), never real threat intel.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.core.errors import (
    IntegrationUnavailableError,
    MissingBrandDNAError,
)
from app.integrations.module1.client import BrandDNAClient
from app.integrations.module1.mock import MockBrandDNAClient
from app.integrations.module1.sentinel import (
    SENTINEL_BRANDS_PATH,
    SENTINEL_BRAND_VERSION,
    SentinelBrandClient,
    sentinel_cuid_to_brand_uuid,
)
from app.integrations.module3.mock import MockEntityProvider, MockEvidenceProvider
from app.main import create_app
from app.risk.config import DEFAULT_RISK_ENGINE_CONFIG
from app.schemas.entity import EntityReference, EvidenceReference
from app.domain.enums import EntityType, EvidenceType
from app.services.evidence import EvidenceService
from app.services.queue import SyncJobQueue, executor_factory

BASE = "http://sentinel.invalid"
NOW = datetime.now(timezone.utc)

# SYNTHETIC TEST_ONLY Sentinel brand. Fields mirror Sentinel's
# normalizeBrand output: domains lowercased, handles lowercased with '@'
# stripped. cuid-style ids are fabricated.
SENTINEL_CUID = "clx0synthetic1brand00000000"
OTHER_CUID = "clx0synthetic1other000000000"
SENTINEL_BRAND_UUID = sentinel_cuid_to_brand_uuid(SENTINEL_CUID)

SENTINEL_ITEMS = [
    {
        "id": OTHER_CUID,
        "name": "Globex",
        "officialDomains": ["globex.example"],
        "officialHandles": ["globex"],
        "appDevelopers": ["Globex Inc"],
        "packagePrefixes": ["com.globex"],
        "keywords": ["globex support", "globex login"],
        "isDemo": False,
        "scanCount": 0,
    },
    {
        "id": SENTINEL_CUID,
        "name": "Acme Corp",
        "officialDomains": ["acme.com", "acme-corp.com"],
        "officialHandles": ["acme_support", "acme_corp"],
        "appDevelopers": ["Acme Inc"],
        "packagePrefixes": ["com.acme.app"],
        "keywords": ["acme support", "acme login"],
        "isDemo": True,
        "scanCount": 3,
    },
]


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


def respond_items(monkeypatch, items):
    return install_transport(
        monkeypatch, lambda req: FakeResponse(payload={"items": list(items)})
    )


@pytest.fixture
def client() -> SentinelBrandClient:
    return SentinelBrandClient(BASE, 1.0)


def synthetic_entity(tenant_id: uuid.UUID) -> EntityReference:
    """SYNTHETIC TEST_ONLY impersonating entity (mirrors conftest)."""
    return EntityReference(
        entity_id=uuid.uuid4(),
        tenant_id=tenant_id,
        entity_type=EntityType.WEBSITE,
        display_name="Acme Corp Support",
        identifiers={"domain": "acme-support.com", "handle": "@acme_help"},
        attributes={},
    )


def synthetic_evidence(entity_id: uuid.UUID) -> list[EvidenceReference]:
    """SYNTHETIC TEST_ONLY 4-item evidence bundle (mirrors conftest)."""
    source_id = uuid.uuid4()
    return [
        EvidenceReference(
            evidence_id=uuid.uuid4(),
            source_id=source_id,
            entity_id=entity_id,
            evidence_type=EvidenceType.TEXT_CONTENT,
            collected_at=NOW,
            text="Acme Corp official support portal — verify your account now",
        ),
        EvidenceReference(
            evidence_id=uuid.uuid4(),
            source_id=source_id,
            entity_id=entity_id,
            evidence_type=EvidenceType.VISUAL_ASSET,
            collected_at=NOW,
            image_hash="ff00aa55ff00aa57",
        ),
        EvidenceReference(
            evidence_id=uuid.uuid4(),
            source_id=source_id,
            entity_id=entity_id,
            evidence_type=EvidenceType.DOMAIN_INTEL,
            collected_at=NOW,
            url="https://acme-support.com/login",
            metadata={"days_since_registration": 12, "whois_privacy": True},
        ),
        EvidenceReference(
            evidence_id=uuid.uuid4(),
            source_id=source_id,
            entity_id=entity_id,
            evidence_type=EvidenceType.BEHAVIORAL_EVENT,
            collected_at=NOW,
            metadata={"recent_account_creation": True, "brand_mimicry_in_bio": True},
        ),
    ]


class TestWireContractAndMapping:
    def test_fetches_list_endpoint_and_maps_brand_dna(self, monkeypatch, client):
        captured = respond_items(monkeypatch, SENTINEL_ITEMS)

        dna = client.get_brand_dna(str(SENTINEL_BRAND_UUID))

        assert captured[0].url == f"{BASE}{SENTINEL_BRANDS_PATH}"
        assert dna.brand_id == SENTINEL_BRAND_UUID
        assert dna.identity.name == "Acme Corp"
        # Sentinel's keywords are abuse vocabulary, not aliases.
        assert dna.identity.aliases == []
        assert [(d.domain, d.is_primary) for d in dna.domains] == [
            ("acme.com", False),
            ("acme-corp.com", False),
        ]
        assert dna.verification.verified_domains == ["acme.com", "acme-corp.com"]
        assert dna.verification.verified_social_handles == ["acme_support", "acme_corp"]
        # Sentinel does not model these; absence is honest, never fabricated.
        assert dna.social_profiles == []
        assert dna.visual_assets == []
        assert dna.text_signals == []
        assert dna.version == SENTINEL_BRAND_VERSION

    def test_accepts_raw_sentinel_cuid(self, monkeypatch, client):
        respond_items(monkeypatch, SENTINEL_ITEMS)
        dna = client.get_brand_dna(SENTINEL_CUID)
        assert dna.identity.name == "Acme Corp"
        assert dna.brand_id == SENTINEL_BRAND_UUID

    def test_satisfies_brand_dna_client_protocol(self, client):
        assert isinstance(client, BrandDNAClient)


class TestMissingBrands:
    def test_absent_brand_is_missing_brand_dna(self, monkeypatch, client):
        respond_items(monkeypatch, [SENTINEL_ITEMS[0]])  # only Globex
        with pytest.raises(MissingBrandDNAError) as excinfo:
            client.get_brand_dna(str(SENTINEL_BRAND_UUID))
        assert excinfo.value.details["brand_id"] == str(SENTINEL_BRAND_UUID)

    def test_absent_raw_cuid_is_missing_brand_dna(self, monkeypatch, client):
        respond_items(monkeypatch, SENTINEL_ITEMS)
        with pytest.raises(MissingBrandDNAError):
            client.get_brand_dna("clx0unknown0000000000000000")

    def test_unidentifiable_items_are_skipped_not_fatal(self, monkeypatch, client):
        items = ["garbage", {"no_id": True}, *SENTINEL_ITEMS]
        respond_items(monkeypatch, items)
        dna = client.get_brand_dna(str(SENTINEL_BRAND_UUID))
        assert dna.identity.name == "Acme Corp"


class TestMalformedResponses:
    def test_non_dict_payload_is_contract_mismatch(self, monkeypatch, client):
        install_transport(monkeypatch, lambda req: FakeResponse(payload=["not", "an", "envelope"]))
        with pytest.raises(IntegrationUnavailableError) as excinfo:
            client.get_brand_dna(str(SENTINEL_BRAND_UUID))
        assert excinfo.value.details["reason"] == "contract_mismatch"

    def test_missing_items_key_is_contract_mismatch(self, monkeypatch, client):
        install_transport(monkeypatch, lambda req: FakeResponse(payload={"data": SENTINEL_ITEMS}))
        with pytest.raises(IntegrationUnavailableError) as excinfo:
            client.get_brand_dna(str(SENTINEL_BRAND_UUID))
        assert excinfo.value.details["reason"] == "contract_mismatch"

    def test_items_not_a_list_is_contract_mismatch(self, monkeypatch, client):
        install_transport(
            monkeypatch, lambda req: FakeResponse(payload={"items": SENTINEL_ITEMS[1]})
        )
        with pytest.raises(IntegrationUnavailableError) as excinfo:
            client.get_brand_dna(str(SENTINEL_BRAND_UUID))
        assert excinfo.value.details["reason"] == "contract_mismatch"

    def test_matched_item_missing_name_is_contract_mismatch(self, monkeypatch, client):
        broken = {**SENTINEL_ITEMS[1]}
        broken.pop("name")
        respond_items(monkeypatch, [broken])
        with pytest.raises(IntegrationUnavailableError) as excinfo:
            client.get_brand_dna(str(SENTINEL_BRAND_UUID))
        assert excinfo.value.details["reason"] == "contract_mismatch"

    def test_matched_item_with_non_list_domains_is_contract_mismatch(
        self, monkeypatch, client
    ):
        broken = {**SENTINEL_ITEMS[1], "officialDomains": "acme.com"}
        respond_items(monkeypatch, [broken])
        with pytest.raises(IntegrationUnavailableError) as excinfo:
            client.get_brand_dna(str(SENTINEL_BRAND_UUID))
        assert excinfo.value.details["reason"] == "contract_mismatch"

    def test_invalid_json_is_integration_unavailable(self, monkeypatch, client):
        install_transport(monkeypatch, lambda req: FakeResponse(json_raises=True))
        with pytest.raises(IntegrationUnavailableError) as excinfo:
            client.get_brand_dna(str(SENTINEL_BRAND_UUID))
        assert excinfo.value.details["reason"] == "invalid_json"

    def test_500_maps_to_http_500_without_body_leak(self, monkeypatch, client):
        install_transport(monkeypatch, lambda req: FakeResponse(
            status_code=500, payload={"error": "internal stack detail must not leak"}
        ))
        with pytest.raises(IntegrationUnavailableError) as excinfo:
            client.get_brand_dna(str(SENTINEL_BRAND_UUID))
        assert excinfo.value.details["reason"] == "http_500"
        assert "stack detail" not in str(excinfo.value)

    def test_404_on_list_route_is_integration_problem_not_missing_brand(
        self, monkeypatch, client
    ):
        """A 404 on /api/brands means the route moved, not that the brand
        is missing — brand absence is decided by scanning the 200 list."""
        install_transport(monkeypatch, lambda req: FakeResponse(status_code=404))
        with pytest.raises(IntegrationUnavailableError) as excinfo:
            client.get_brand_dna(str(SENTINEL_BRAND_UUID))
        assert excinfo.value.details["reason"] == "http_404"


class TestTimeoutsAndTransport:
    def test_timeout_maps_to_network_error(self, monkeypatch, client):
        def explode(request):
            raise httpx.TimeoutException("timed out")

        install_transport(monkeypatch, explode)
        with pytest.raises(IntegrationUnavailableError) as excinfo:
            client.get_brand_dna(str(SENTINEL_BRAND_UUID))
        assert excinfo.value.details["reason"] == "network_error"

    def test_connect_error_maps_to_network_error(self, monkeypatch, client):
        def explode(request):
            raise httpx.ConnectError("connection refused")

        install_transport(monkeypatch, explode)
        with pytest.raises(IntegrationUnavailableError) as excinfo:
            client.get_brand_dna(str(SENTINEL_BRAND_UUID))
        assert excinfo.value.details["reason"] == "network_error"


class TestTenantIsolation:
    def test_no_tenant_header_sent_to_module1(self, monkeypatch, client):
        """Brand anchors are tenant-agnostic: Module 1 receives no tenancy."""
        captured = respond_items(monkeypatch, SENTINEL_ITEMS)
        client.get_brand_dna(str(SENTINEL_BRAND_UUID))
        assert "X-Tenant-ID" not in captured[0].headers

    def test_two_tenants_sharing_one_sentinel_brand_get_separate_threats(
        self, monkeypatch, engine
    ):
        tenant_a, tenant_b = uuid.uuid4(), uuid.uuid4()
        entities = [synthetic_entity(t) for t in (tenant_a, tenant_b)]
        evidence: list[EvidenceReference] = []
        for entity in entities:
            evidence.extend(synthetic_evidence(entity.entity_id))

        settings = Settings(worker_mode="sync", module1_base_url=BASE, _env_file=None)
        app = create_app(settings, engine=engine)
        with TestClient(app) as test_client:
            state = test_client.app.state
            assert isinstance(state.brand_client, SentinelBrandClient)
            state.entity_provider = MockEntityProvider(entities)
            state.evidence_provider = MockEvidenceProvider(evidence)
            state.evidence_service = EvidenceService(
                state.evidence_provider, DEFAULT_RISK_ENGINE_CONFIG
            )
            factory = executor_factory(
                brand_client=state.brand_client,
                entity_provider=state.entity_provider,
                evidence_provider=state.evidence_provider,
                models=state.models,
                risk_service=state.risk_service,
                evidence_service=state.evidence_service,
                publisher=state.publisher,
            )
            state.queue = SyncJobQueue(factory, state.session_factory)

            captured = respond_items(monkeypatch, SENTINEL_ITEMS)
            prefix = state.settings.api_v1_prefix
            threat_ids = {}
            for tenant, entity in zip((tenant_a, tenant_b), entities):
                response = test_client.post(
                    f"{prefix}/analysis",
                    json={
                        "brand_id": str(SENTINEL_BRAND_UUID),
                        "entity_id": str(entity.entity_id),
                    },
                    headers={"X-Tenant-ID": str(tenant)},
                )
                assert response.status_code == 200, response.text
                body = response.json()
                assert body["status"] == "COMPLETED", body
                threat_ids[tenant] = body["result"]["threat_id"]

            assert threat_ids[tenant_a] != threat_ids[tenant_b]
            # Each tenant's analysis fetched the shared brand DNA itself.
            assert len(captured) == 2
            for tenant, expected_threat in threat_ids.items():
                listing = test_client.get(
                    f"{prefix}/threats", headers={"X-Tenant-ID": str(tenant)}
                )
                assert listing.status_code == 200
                payload = listing.json()
                assert payload["total"] == 1
                item = payload["items"][0]
                assert item["threat_id"] == expected_threat
                assert item["brand_id"] == str(SENTINEL_BRAND_UUID)


class TestAppBinding:
    def test_sentinel_client_bound_when_module1_base_url_set(self, engine):
        settings = Settings(worker_mode="sync", module1_base_url=BASE, _env_file=None)
        app = create_app(settings, engine=engine)
        with TestClient(app) as test_client:
            assert isinstance(test_client.app.state.brand_client, SentinelBrandClient)

    def test_mock_client_bound_without_module1_base_url(self, engine):
        settings = Settings(worker_mode="sync", _env_file=None)
        app = create_app(settings, engine=engine)
        with TestClient(app) as test_client:
            assert isinstance(test_client.app.state.brand_client, MockBrandDNAClient)
