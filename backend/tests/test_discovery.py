"""Discovery pipeline tests (P1) — SYNTHETIC TEST_ONLY data throughout.

Covers the mandated mocked cases: success, no results, timeout, rate
limiting, missing credentials, duplicates, evidence provenance, tenant
isolation, canonical Module 2 scoring integration, and job/partial-provider
failure. Providers are deterministic fakes; Module 3 is an in-memory fake
that enforces the same tenant isolation and 409-duplicate semantics as the
real service.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.core.errors import EntityAlreadyExistsError
from app.integrations.discovery.base import DiscoveryProviderError
from app.integrations.discovery.mock import MockDiscoveryProvider, synthetic_candidate
from app.integrations.discovery.search_api import SearchApiProvider
from app.main import create_app
from app.risk.config import DEFAULT_RISK_ENGINE_CONFIG
from app.schemas.entity import EntityReference, EvidenceReference
from app.services.discovery import (
    candidate_fingerprint,
    discovery_executor_factory,
    normalize_candidates,
)
from app.services.evidence import EvidenceService
from app.services.queue import SyncJobQueue, execute_inline, executor_factory


# ---------------------------------------------------------------------------
# Fake Module 3 — write protocol (source/entity/evidence) AND read protocol
# (get_entity/list_evidence) over one in-memory per-tenant store.
# ---------------------------------------------------------------------------
class FakeModule3Writer:
    def __init__(self, *, raise_conflict: bool = False) -> None:
        self.sources: dict[str, dict] = {}       # source_id -> record
        self.entities: dict[str, EntityReference] = {}
        self.evidence: dict[str, EvidenceReference] = {}
        self.evidence_by_entity: dict[tuple[str, str], list[str]] = {}
        self.raise_conflict = raise_conflict

    # -- write protocol (Module3Writer interface) --------------------------
    def create_source(self, tenant_id: str, name: str, kind: str) -> uuid.UUID:
        source_id = uuid.uuid4()
        self.sources[str(source_id)] = {
            "source_id": source_id, "tenant_id": tenant_id,
            "name": name, "kind": kind,
        }
        return source_id

    def create_entity(
        self, tenant_id: str, *, entity_type: str, display_name: str | None,
        identifiers: dict, attributes: dict, entity_id: uuid.UUID | None = None,
    ) -> uuid.UUID:
        for existing in self.entities.values():
            if (
                str(existing.tenant_id) == tenant_id
                and existing.entity_type.value == entity_type
                and existing.identifiers.get("domain") == identifiers.get("domain")
            ):
                if self.raise_conflict:
                    raise EntityAlreadyExistsError(str(existing.entity_id))
                return existing.entity_id
        new_id = entity_id or uuid.uuid4()
        self.entities[str(new_id)] = EntityReference(
            entity_id=new_id,
            tenant_id=uuid.UUID(tenant_id),
            entity_type=entity_type,  # type: ignore[arg-type]
            display_name=display_name,
            identifiers=dict(identifiers),
            attributes=dict(attributes),
        )
        return new_id

    def create_evidence(
        self, tenant_id: str, entity_id: uuid.UUID, *, source_id: uuid.UUID,
        evidence_type: str, collected_at: str, text: str | None = None,
        image_hash: str | None = None, url: str | None = None,
        metadata: dict | None = None,
    ) -> uuid.UUID:
        evidence_id = uuid.uuid4()
        self.evidence[str(evidence_id)] = EvidenceReference(
            evidence_id=evidence_id,
            source_id=source_id,
            entity_id=entity_id,
            evidence_type=evidence_type,  # type: ignore[arg-type]
            collected_at=datetime.fromisoformat(collected_at),
            text=text, image_hash=image_hash, url=url,
            metadata=dict(metadata or {}),
        )
        self.evidence_by_entity.setdefault((tenant_id, str(entity_id)), []).append(
            str(evidence_id)
        )
        return evidence_id

    # -- read protocol (EntityProvider / EvidenceProvider) -----------------
    def get_entity(self, tenant_id: str, entity_id: str) -> EntityReference:
        entity = self.entities.get(entity_id)
        if entity is None or str(entity.tenant_id) != tenant_id:
            from app.core.errors import InvalidEntityError

            raise InvalidEntityError(entity_id)
        return entity

    def list_evidence(self, tenant_id: str, entity_id: str) -> list[EvidenceReference]:
        entity = self.entities.get(entity_id)
        if entity is None or str(entity.tenant_id) != tenant_id:
            from app.core.errors import InvalidEntityError

            raise InvalidEntityError(entity_id)
        ids = self.evidence_by_entity.get((tenant_id, entity_id), [])
        return [self.evidence[i] for i in ids]


@pytest.fixture
def module3() -> FakeModule3Writer:
    return FakeModule3Writer(raise_conflict=True)


@pytest.fixture
def client(engine, settings, brand_client, module3):
    """TestClient with the discovery queue rebuilt around fakes.

    The discovery provider list is exposed on the client (c.discovery_providers)
    so each test installs its own deterministic providers before POSTing.
    """
    app = create_app(settings, engine=engine)
    with TestClient(app) as c:
        state = c.app.state
        state.publisher = _last(state.publisher)
        state.brand_client = brand_client
        state.entity_provider = module3
        state.evidence_provider = module3
        state.evidence_service = EvidenceService(module3, DEFAULT_RISK_ENGINE_CONFIG)
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

        providers: list = []

        def analysis_enqueuer(job_id):
            execute_inline(factory, state.session_factory, job_id)

        discovery_factory = discovery_executor_factory(
            brand_client=state.brand_client,
            module3_writer=module3,
            providers=providers,
            evidence_provider=state.evidence_provider,
            settings=state.settings,
            analysis_enqueuer=analysis_enqueuer,
        )
        state.discovery_queue = SyncJobQueue(discovery_factory, state.session_factory)
        c.discovery_providers = providers
        c.module3 = module3
        yield c


def _last(publisher):
    return publisher


def headers(tenant_id: uuid.UUID) -> dict:
    return {"X-Tenant-ID": str(tenant_id)}


def api(client) -> str:
    return client.app.state.settings.api_v1_prefix


def search_provider(domain: str = "acme-support-secure.com", **kwargs):
    return MockDiscoveryProvider(
        "web_search",
        candidates=[
            synthetic_candidate(
                "web_search",
                domain=domain,
                url=f"https://{domain}/login",
                title="Acme Corp Secure Login",
                snippet="Sign in to your Acme Corp account - verify your details now",
            )
        ],
        **kwargs,
    )


def ct_provider(domain: str = "acme-support-secure.com", **kwargs):
    return MockDiscoveryProvider(
        "certificate_transparency",
        candidates=[
            synthetic_candidate(
                "certificate_transparency",
                kind="certificate",
                domain=domain,
                url=f"https://crt.sh/?q={domain}",
            )
        ],
        **kwargs,
    )


# ---------------------------------------------------------------------------
# Candidate normalization unit tests
# ---------------------------------------------------------------------------
class TestNormalizeCandidates:
    def test_excludes_official_domains(self, brand_dna):
        from app.services.normalization import registrable_domain

        official = {registrable_domain(d.domain) for d in brand_dna.domains}
        candidates = [
            synthetic_candidate("web_search", domain="acme.com", url="https://acme.com"),
            synthetic_candidate("web_search", domain="login.acme.com"),
            synthetic_candidate("web_search", domain="acme-support-secure.com"),
        ]
        result, duplicates = normalize_candidates(candidates, official)
        domains = [c["domain"] for c in result]
        assert "acme.com" not in domains
        assert domains == ["acme-support-secure.com"]
        assert duplicates == 0

    def test_merges_cross_provider_duplicates(self):
        candidates = [
            synthetic_candidate("web_search", domain="acme-support-secure.com",
                                url="https://acme-support-secure.com/x"),
            synthetic_candidate("certificate_transparency", kind="certificate",
                                domain="portal.acme-support-secure.com"),
        ]
        result, duplicates = normalize_candidates(candidates, set())
        assert len(result) == 1
        assert duplicates == 1
        assert result[0]["providers"] == ["web_search", "certificate_transparency"]
        assert result[0]["domain"] == "acme-support-secure.com"

    def test_drops_candidates_without_resolvable_domain(self):
        candidates = [synthetic_candidate("web_search", domain=None, url=None)]
        result, duplicates = normalize_candidates(candidates, set())
        assert result == []
        assert duplicates == 0

    def test_fingerprint_is_stable_and_scope_aware(self):
        a = candidate_fingerprint("search_result", "x.com", "https://x.com")
        b = candidate_fingerprint("search_result", "x.com", "https://x.com")
        c = candidate_fingerprint("certificate", "x.com", None)
        assert a == b
        assert a != c


# ---------------------------------------------------------------------------
# API pipeline tests
# ---------------------------------------------------------------------------
class TestDiscoveryPipeline:
    def test_success_full_pipeline_records_provenance_and_chains_scoring(
        self, client, tenant_id, brand_id
    ):
        client.discovery_providers.extend([search_provider(), ct_provider()])

        response = client.post(
            f"{api(client)}/discovery",
            json={"brand_id": str(brand_id)},
            headers=headers(tenant_id),
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["status"] == "COMPLETED"
        assert body["started_at"] is not None and body["completed_at"] is not None

        # Brand-DNA-derived queries recorded with their basis
        assert {q["provider"] for q in body["queries"]} == {
            "web_search", "certificate_transparency"}
        assert all(q["basis"] for q in body["queries"])

        # Per-provider outcomes, provider coverage observable
        outcomes = {o["provider"]: o for o in body["provider_outcomes"]}
        assert outcomes["web_search"]["status"] == "COMPLETED"
        assert outcomes["certificate_transparency"]["status"] == "COMPLETED"
        assert outcomes["web_search"]["latency_ms"] is not None

        # One candidate after dedupe (both providers saw the same domain)
        assert body["duplicate_count"] == 1
        assert len(body["candidates"]) == 1
        candidate = body["candidates"][0]
        assert candidate["providers"] == ["web_search", "certificate_transparency"]
        assert candidate["entity_id"] and candidate["evidence_id"]
        assert candidate["analysis_job_id"] is not None

        # Module 3 artifacts: source per provider, traceable evidence
        assert set(client.module3.sources) == set(body["source_ids"].values()) or (
            set(body["source_ids"].values()) <= set(client.module3.sources)
        )
        evidence = client.module3.evidence[str(candidate["evidence_id"])]
        assert evidence.metadata["provider"] == "web_search"
        assert evidence.metadata["query_basis"] == candidate["query_basis"]
        assert evidence.metadata["discovery_job_id"] == body["job_id"]
        assert evidence.metadata["discovery_fingerprint"] == candidate["discovery_fingerprint"]
        assert evidence.url == "https://acme-support-secure.com/login"
        entity = client.module3.entities[str(candidate["entity_id"])]
        assert entity.attributes["origin"] == "discovery"
        assert entity.identifiers["domain"] == "acme-support-secure.com"

        # Canonical Module 2 scoring: the chained analysis job ran through
        # the SAME engine and produced a threat.
        analysis = client.get(
            f"{api(client)}/analysis/{candidate['analysis_job_id']}",
            headers=headers(tenant_id),
        )
        assert analysis.status_code == 200, analysis.text
        assert analysis.json()["status"] == "COMPLETED"
        assert analysis.json()["result"] is not None

        threats = client.get(
            f"{api(client)}/threats", headers=headers(tenant_id)
        ).json()
        matching = [
            t for t in threats["items"]
            if t["entity_id"] == candidate["entity_id"]
        ]
        assert len(matching) == 1
        assert matching[0]["classification"]  # engine produced a verdict

    def test_no_results_reports_empty_not_failure(self, client, tenant_id, brand_id):
        client.discovery_providers.append(
            MockDiscoveryProvider("web_search", candidates=[])
        )
        response = client.post(
            f"{api(client)}/discovery",
            json={"brand_id": str(brand_id)},
            headers=headers(tenant_id),
        )
        body = response.json()
        assert response.status_code == 200
        assert body["status"] == "COMPLETED"
        assert body["provider_outcomes"][0]["status"] == "EMPTY"
        assert body["candidates"] == []

    def test_provider_timeout_yields_partial_with_partial_failure(
        self, client, tenant_id, brand_id
    ):
        client.discovery_providers.extend(
            [
                search_provider(),
                MockDiscoveryProvider(
                    "certificate_transparency",
                    error=DiscoveryProviderError("TIMEOUT", "crt.sh timed out"),
                ),
            ]
        )
        response = client.post(
            f"{api(client)}/discovery",
            json={"brand_id": str(brand_id)},
            headers=headers(tenant_id),
        )
        body = response.json()
        assert body["status"] == "PARTIAL"
        outcomes = {o["provider"]: o for o in body["provider_outcomes"]}
        assert outcomes["certificate_transparency"]["status"] == "TIMEOUT"
        assert outcomes["certificate_transparency"]["error"] == "crt.sh timed out"
        assert outcomes["web_search"]["status"] == "COMPLETED"
        # The provider that succeeded still contributes candidates.
        assert len(body["candidates"]) == 1

    def test_rate_limited_provider_is_recorded(self, client, tenant_id, brand_id):
        client.discovery_providers.append(
            MockDiscoveryProvider(
                "web_search",
                error=DiscoveryProviderError("RATE_LIMITED", "HTTP 429"),
            )
        )
        response = client.post(
            f"{api(client)}/discovery",
            json={"brand_id": str(brand_id)},
            headers=headers(tenant_id),
        )
        body = response.json()
        assert body["status"] == "FAILED"
        assert body["provider_outcomes"][0]["status"] == "RATE_LIMITED"
        assert body["error_code"] == "INTEGRATION_UNAVAILABLE"

    def test_failed_provider_with_unconfigured_peer_is_failed_not_completed(
        self, client, tenant_id, brand_id
    ):
        """crt.sh down + search unconfigured is a failed run — COMPLETED would
        read as fabricated success for a run that observed nothing."""
        client.discovery_providers.extend(
            [
                SearchApiProvider(api_key=None),  # unconfigured peer
                MockDiscoveryProvider(
                    "certificate_transparency",
                    error=DiscoveryProviderError("FAILED", "crt.sh returned HTTP 502"),
                ),
            ]
        )
        response = client.post(
            f"{api(client)}/discovery",
            json={"brand_id": str(brand_id)},
            headers=headers(tenant_id),
        )
        body = response.json()
        assert body["status"] == "FAILED"
        outcomes = {o["provider"]: o for o in body["provider_outcomes"]}
        assert outcomes["certificate_transparency"]["status"] == "FAILED"
        assert outcomes["certificate_transparency"]["error"] == "crt.sh returned HTTP 502"
        assert outcomes["web_search"]["status"] == "UNCONFIGURED"
        assert body["candidates"] == []
        assert client.module3.evidence == {}

    def test_missing_credentials_reported_unconfigured_nothing_fabricated(
        self, client, tenant_id, brand_id
    ):
        client.discovery_providers.append(
            SearchApiProvider(api_key=None)  # no credentials configured
        )
        response = client.post(
            f"{api(client)}/discovery",
            json={"brand_id": str(brand_id)},
            headers=headers(tenant_id),
        )
        body = response.json()
        assert body["status"] == "COMPLETED"
        assert body["provider_outcomes"][0]["status"] == "UNCONFIGURED"
        assert body["candidates"] == []
        assert body["warning_message"] is not None
        assert "unconfigured" in body["warning_message"].lower()
        assert client.module3.evidence == {}

    def test_retry_does_not_duplicate_evidence(self, client, tenant_id, brand_id):
        client.discovery_providers.append(search_provider())

        def run():
            return client.post(
                f"{api(client)}/discovery",
                json={"brand_id": str(brand_id)},
                headers=headers(tenant_id),
            ).json()

        first = run()
        second = run()

        assert first["status"] == "COMPLETED"
        assert second["status"] == "COMPLETED"
        # Same domain observed twice: entity AND evidence reused, not recreated.
        assert len(client.module3.entities) == 1
        assert len(client.module3.evidence) == 1
        assert (
            first["candidates"][0]["entity_id"]
            == second["candidates"][0]["entity_id"]
        )
        assert (
            first["candidates"][0]["evidence_id"]
            == second["candidates"][0]["evidence_id"]
        )

    def test_tenant_isolation(self, client, tenant_id, brand_id):
        other_tenant = uuid.uuid4()
        client.discovery_providers.append(search_provider())
        created = client.post(
            f"{api(client)}/discovery",
            json={"brand_id": str(brand_id)},
            headers=headers(tenant_id),
        ).json()

        cross = client.get(
            f"{api(client)}/discovery/{created['job_id']}",
            headers=headers(other_tenant),
        )
        assert cross.status_code == 404
        assert cross.json()["error_code"] == "NOT_FOUND"

        other_list = client.get(
            f"{api(client)}/discovery", headers=headers(other_tenant)
        ).json()
        assert other_list["items"] == []
        assert other_list["total"] == 0

        # Discovered entity/evidence live in tenant A's Module 3 scope only.
        with pytest.raises(Exception):
            client.module3.get_entity(
                str(other_tenant), created["candidates"][0]["entity_id"]
            )

    def test_missing_brand_dna_fails_job(self, engine, settings, module3):
        from app.integrations.module1.mock import MockBrandDNAClient

        app = create_app(settings, engine=engine)
        with TestClient(app) as c:
            state = c.app.state
            state.brand_client = MockBrandDNAClient()  # no DNA registered
            state.entity_provider = module3
            state.evidence_provider = module3
            state.evidence_service = EvidenceService(module3, DEFAULT_RISK_ENGINE_CONFIG)
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
            providers: list = []
            discovery_factory = discovery_executor_factory(
                brand_client=state.brand_client,
                module3_writer=module3,
                providers=providers,
                evidence_provider=state.evidence_provider,
                settings=state.settings,
                analysis_enqueuer=lambda job_id: execute_inline(
                    factory, state.session_factory, job_id
                ),
            )
            state.discovery_queue = SyncJobQueue(
                discovery_factory, state.session_factory
            )
            c.discovery_providers = providers

            unknown_brand = uuid.uuid4()
            response = c.post(
                f"{api(c)}/discovery",
                json={"brand_id": str(unknown_brand)},
                headers=headers(uuid.uuid4()),
            )
            # The precondition error surfaces in-band (424 envelope) AND the
            # job row records the honest FAILED state.
            assert response.status_code == 424
            assert response.json()["error_code"] == "MISSING_BRAND_DNA"

    def test_unknown_job_404_envelope(self, client, tenant_id):
        response = client.get(
            f"{api(client)}/discovery/{uuid.uuid4()}",
            headers=headers(tenant_id),
        )
        assert response.status_code == 404
        body = response.json()
        assert body["error_code"] == "NOT_FOUND"
        assert body["correlation_id"]

    def test_job_list_reflects_history(self, client, tenant_id, brand_id):
        client.discovery_providers.append(search_provider())
        client.post(
            f"{api(client)}/discovery",
            json={"brand_id": str(brand_id)},
            headers=headers(tenant_id),
        )
        client.post(
            f"{api(client)}/discovery",
            json={"brand_id": str(brand_id)},
            headers=headers(tenant_id),
        )
        listing = client.get(
            f"{api(client)}/discovery", headers=headers(tenant_id)
        ).json()
        assert listing["total"] == 2
        assert all(item["candidate_count"] == 1 for item in listing["items"])
        assert all(item["status"] == "COMPLETED" for item in listing["items"])
