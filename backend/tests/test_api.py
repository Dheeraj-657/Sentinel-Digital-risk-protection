"""API-layer tests: HTTP contract through FastAPI TestClient.

Uses the MOCK Module 1/3 adapters and SYNTHETIC TEST_ONLY data. The app is
built with an injected in-memory SQLite engine (StaticPool) so the API and
the worker share the same database.
"""
from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.risk.config import DEFAULT_RISK_ENGINE_CONFIG
from app.services.queue import SyncJobQueue, executor_factory


@pytest.fixture
def client(engine, settings, brand_client, entity_provider, evidence_provider,
           evidence_service, publisher):
    """TestClient with synthetic collaborators bound after startup.

    The lifespan binds empty MOCK providers and builds the queue with a
    factory closing over them, so after startup we rebind the synthetic
    fixtures AND rebuild the queue so the executor factory sees them."""
    app = create_app(settings, engine=engine)
    with TestClient(app) as c:
        state = c.app.state
        state.publisher = publisher
        state.brand_client = brand_client
        state.entity_provider = entity_provider
        state.evidence_provider = evidence_provider
        state.evidence_service = evidence_service
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
        yield c


def headers(tenant_id: uuid.UUID) -> dict:
    return {"X-Tenant-ID": str(tenant_id)}


def post_analysis(client, tenant_id, brand_id, entity_id, **extra_headers):
    return client.post(
        f"{client.app.state.settings.api_v1_prefix}/analysis",
        json={"brand_id": str(brand_id), "entity_id": str(entity_id)},
        headers={**headers(tenant_id), **extra_headers},
    )


def run_analysis(client, tenant_id, brand_id, entity_id) -> dict:
    response = post_analysis(client, tenant_id, brand_id, entity_id)
    assert response.status_code == 200, response.text
    return response.json()


class TestAnalysisEndpoint:
    def test_create_analysis_completes_synchronously(
        self, client, tenant_id, brand_id, entity_id
    ):
        body = run_analysis(client, tenant_id, brand_id, entity_id)

        assert body["status"] == "COMPLETED"
        assert body["brand_id"] == str(brand_id)
        assert body["entity_id"] == str(entity_id)
        assert body["error_code"] is None
        assert body["started_at"] is not None
        assert body["completed_at"] is not None
        result = body["result"]
        assert result is not None
        assert 0 <= result["risk_score"] <= 100
        assert result["evidence_count"] > 0
        assert result["threat_id"]

    def test_idempotency_key_replay_returns_same_job(
        self, client, tenant_id, brand_id, entity_id
    ):
        key = "synthetic-idempotency-key-1"
        first = post_analysis(client, tenant_id, brand_id, entity_id,
                              **{"Idempotency-Key": key})
        second = post_analysis(client, tenant_id, brand_id, entity_id,
                               **{"Idempotency-Key": key})

        assert first.status_code == 200
        assert second.status_code == 200
        assert first.json()["job_id"] == second.json()["job_id"]
        assert second.headers["Idempotency-Key"] == key

    def test_idempotency_key_conflict_on_different_payload(
        self, client, tenant_id, brand_id, entity_id
    ):
        key = "synthetic-idempotency-key-2"
        other_entity = uuid.uuid4()
        first = post_analysis(client, tenant_id, brand_id, entity_id,
                              **{"Idempotency-Key": key})
        conflict = post_analysis(client, tenant_id, brand_id, other_entity,
                                 **{"Idempotency-Key": key})

        assert first.status_code == 200
        assert conflict.status_code == 409
        assert conflict.json()["error_code"] == "DUPLICATE_JOB"
        assert conflict.json()["correlation_id"]

    def test_missing_tenant_header_rejected(self, client, brand_id, entity_id):
        response = client.post(
            f"{client.app.state.settings.api_v1_prefix}/analysis",
            json={"brand_id": str(brand_id), "entity_id": str(entity_id)},
        )

        assert response.status_code == 400
        assert response.json()["error_code"] == "TENANT_REQUIRED"

    def test_tenant_header_must_be_uuid(self, client, brand_id, entity_id):
        response = client.post(
            f"{client.app.state.settings.api_v1_prefix}/analysis",
            json={"brand_id": str(brand_id), "entity_id": str(entity_id)},
            headers={"X-Tenant-ID": "not-a-uuid"},
        )

        assert response.status_code == 400
        assert response.json()["error_code"] == "VALIDATION_ERROR"

    def test_get_job_by_id(self, client, tenant_id, brand_id, entity_id):
        created = run_analysis(client, tenant_id, brand_id, entity_id)
        response = client.get(
            f"{client.app.state.settings.api_v1_prefix}/analysis/{created['job_id']}",
            headers=headers(tenant_id),
        )

        assert response.status_code == 200
        assert response.json()["job_id"] == created["job_id"]
        assert response.json()["status"] == "COMPLETED"
        assert response.json()["result"]["risk_score"] == \
            created["result"]["risk_score"]

    def test_get_unknown_job_returns_404_envelope(self, client, tenant_id):
        response = client.get(
            f"{client.app.state.settings.api_v1_prefix}/analysis/{uuid.uuid4()}",
            headers=headers(tenant_id),
        )

        assert response.status_code == 404
        envelope = response.json()
        assert envelope["error_code"] == "NOT_FOUND"
        assert envelope["correlation_id"]
        assert "Traceback" not in envelope["message"]

    def test_invalid_body_returns_422_envelope(self, client, tenant_id):
        response = client.post(
            f"{client.app.state.settings.api_v1_prefix}/analysis",
            json={"entity_id": "nope"},
            headers=headers(tenant_id),
        )

        assert response.status_code == 422
        envelope = response.json()
        assert envelope["error_code"] == "VALIDATION_ERROR"
        errors = envelope["details"]["errors"]
        assert any("brand_id" in err["loc"] for err in errors)
        assert any("entity_id" in err["loc"] for err in errors)

    def test_oversized_body_rejected_413(self, client, tenant_id):
        response = client.post(
            f"{client.app.state.settings.api_v1_prefix}/analysis",
            content=b"x" * (client.app.state.settings.max_request_body_bytes + 1),
            headers={**headers(tenant_id), "Content-Type": "application/json"},
        )

        assert response.status_code == 413
        assert response.json()["error_code"] == "VALIDATION_ERROR"


class TestThreatEndpoints:
    def test_list_and_get_threat_detail(
        self, client, tenant_id, brand_id, entity_id
    ):
        run_analysis(client, tenant_id, brand_id, entity_id)
        prefix = client.app.state.settings.api_v1_prefix

        listing = client.get(f"{prefix}/threats", headers=headers(tenant_id))
        assert listing.status_code == 200
        payload = listing.json()
        assert payload["total"] == 1
        assert len(payload["items"]) == 1
        summary = payload["items"][0]
        assert summary["brand_id"] == str(brand_id)
        assert summary["entity_id"] == str(entity_id)
        assert summary["risk_level"] in {"LOW", "MEDIUM", "HIGH", "CRITICAL"}

        detail = client.get(f"{prefix}/threats/{summary['threat_id']}",
                            headers=headers(tenant_id))
        assert detail.status_code == 200
        threat = detail.json()
        assert threat["risk_factors"], "explainability factors are mandatory"
        for factor in threat["risk_factors"]:
            assert 0 <= factor["score"] <= 100
            assert 0.0 <= factor["weight"] <= 1.0
            assert factor["basis"] in {"OBSERVED", "DERIVED", "INFERRED", "PREDICTED"}
            assert factor["evidence_ids"]
        assert threat["evidence_references"]
        for ref in threat["evidence_references"]:
            assert ref["evidence_id"]
            assert ref["source_id"]

    def test_status_transitions_publish_events(
        self, client, tenant_id, brand_id, entity_id, publisher
    ):
        created = run_analysis(client, tenant_id, brand_id, entity_id)
        threat_id = created["result"]["threat_id"]
        prefix = client.app.state.settings.api_v1_prefix
        url = f"{prefix}/threats/{threat_id}/status"

        def patch(status: str):
            return client.patch(url, json={"status": status},
                                headers=headers(tenant_id))

        confirmed = patch("CONFIRMED")
        assert confirmed.status_code == 200
        assert confirmed.json()["status"] == "CONFIRMED"

        # CONFIRMED -> DISMISSED is not a legal direct jump.
        skipped = patch("DISMISSED")
        assert skipped.status_code == 409
        assert skipped.json()["error_code"] == "INVALID_STATUS_TRANSITION"

        reopened = patch("OPEN")
        assert reopened.status_code == 200
        dismissed = patch("DISMISSED")
        assert dismissed.status_code == 200
        assert dismissed.json()["status"] == "DISMISSED"

        status_events = [
            e for e in publisher.events
            if e["metadata"]["event_type"] == "threat.status_changed"
        ]
        assert [(e["data"]["previous_status"], e["data"]["new_status"]) for e in status_events] == [
            ("OPEN", "CONFIRMED"),
            ("CONFIRMED", "OPEN"),
            ("OPEN", "DISMISSED"),
        ]
        for event in status_events:
            assert event["metadata"]["tenant_id"] == str(tenant_id)

    def test_get_unknown_threat_returns_404(self, client, tenant_id):
        response = client.get(
            f"{client.app.state.settings.api_v1_prefix}/threats/{uuid.uuid4()}",
            headers=headers(tenant_id),
        )

        assert response.status_code == 404
        assert response.json()["error_code"] == "NOT_FOUND"

    def test_tenant_isolation_hides_other_tenants_data(
        self, client, tenant_id, brand_id, entity_id
    ):
        created = run_analysis(client, tenant_id, brand_id, entity_id)
        other_tenant = uuid.uuid4()
        prefix = client.app.state.settings.api_v1_prefix

        listing = client.get(f"{prefix}/threats", headers=headers(other_tenant))
        assert listing.status_code == 200
        assert listing.json()["total"] == 0

        detail = client.get(f"{prefix}/threats/{created['result']['threat_id']}",
                            headers=headers(other_tenant))
        assert detail.status_code == 404


class TestOpsEndpoints:
    def test_healthz(self, client):
        response = client.get("/healthz")
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "ok"
        assert body["service"] == "trustgraph-module-2"
        assert body["version"]

    def test_readyz_checks_database(self, client):
        response = client.get("/readyz")
        assert response.status_code == 200
        assert response.json() == {"status": "ready", "checks": {"database": "ok"}}

    def test_metrics_endpoint_exposes_request_counters(self, client):
        client.get("/healthz")
        response = client.get("/metrics")
        assert response.status_code == 200
        assert "http_requests_total" in response.text

    def test_correlation_id_is_echoed(self, client):
        response = client.get("/healthz", headers={"X-Correlation-ID": "synthetic-corr-42"})
        assert response.headers["X-Correlation-ID"] == "synthetic-corr-42"
