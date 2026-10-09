"""List-endpoint tests added for the TRUSTGRAPH console UI —
GET /api/v1/entities and GET /api/v1/sources (SYNTHETIC TEST_ONLY data)."""
from __future__ import annotations

ENTITY_LIST_KEYS = {
    "entity_id",
    "tenant_id",
    "entity_type",
    "display_name",
    "identifiers",
    "attributes",
    "created_at",
    "updated_at",
}
SOURCE_KEYS = {"source_id", "name", "kind", "created_at"}


class TestEntityList:
    def test_empty_tenant_gets_empty_list(self, client, tenant_headers, tenant_a):
        response = client.get("/api/v1/entities", headers=tenant_headers(tenant_a))
        assert response.status_code == 200
        assert response.json() == {"items": [], "total": 0, "limit": 50, "offset": 0}

    def test_lists_entities_with_item_shape(self, client, tenant_headers, make_entity, tenant_a):
        make_entity(tenant_a, display_name="Synthetic Impersonator One")
        response = client.get("/api/v1/entities", headers=tenant_headers(tenant_a))
        assert response.status_code == 200
        body = response.json()
        assert body["total"] == 1
        assert len(body["items"]) == 1
        assert set(body["items"][0]) == ENTITY_LIST_KEYS
        assert body["items"][0]["display_name"] == "Synthetic Impersonator One"

    def test_newest_first(self, client, tenant_headers, make_entity, tenant_a):
        headers = tenant_headers(tenant_a)
        first = make_entity(tenant_a, display_name="synthetic-first")
        second = make_entity(tenant_a, display_name="synthetic-second")
        response = client.get("/api/v1/entities", headers=headers)
        items = response.json()["items"]
        assert len(items) == 2
        assert items[0]["entity_id"] == second["entity_id"]
        assert items[1]["entity_id"] == first["entity_id"]
        assert items[0]["created_at"] >= items[1]["created_at"]

    def test_pagination(self, client, tenant_headers, make_entity, tenant_a):
        headers = tenant_headers(tenant_a)
        for i in range(3):
            make_entity(tenant_a, display_name=f"synthetic-{i}")
        page_one = client.get(
            "/api/v1/entities", params={"limit": 2, "offset": 0}, headers=headers
        )
        assert page_one.json()["total"] == 3
        assert len(page_one.json()["items"]) == 2
        assert page_one.json()["limit"] == 2
        assert page_one.json()["offset"] == 0
        page_two = client.get(
            "/api/v1/entities", params={"limit": 2, "offset": 2}, headers=headers
        )
        assert len(page_two.json()["items"]) == 1
        # no overlap between pages
        page_one_ids = {item["entity_id"] for item in page_one.json()["items"]}
        page_two_ids = {item["entity_id"] for item in page_two.json()["items"]}
        assert page_one_ids.isdisjoint(page_two_ids)

    def test_tenant_isolation(self, client, tenant_headers, make_entity, tenant_a, tenant_b):
        make_entity(tenant_a, display_name="tenant-a-only")
        response = client.get("/api/v1/entities", headers=tenant_headers(tenant_b))
        assert response.status_code == 200
        assert response.json()["total"] == 0
        assert response.json()["items"] == []

    def test_limit_bounds_enforced(self, client, tenant_headers, tenant_a):
        headers = tenant_headers(tenant_a)
        assert (
            client.get("/api/v1/entities", params={"limit": 0}, headers=headers).status_code
            == 422
        )
        assert (
            client.get("/api/v1/entities", params={"limit": 201}, headers=headers).status_code
            == 422
        )
        assert (
            client.get("/api/v1/entities", params={"offset": -1}, headers=headers).status_code
            == 422
        )

    def test_missing_tenant_header_rejected(self, client):
        response = client.get("/api/v1/entities")
        assert response.status_code == 400
        assert response.json()["error_code"] == "TENANT_REQUIRED"


class TestSourceList:
    def test_empty_tenant_gets_empty_list(self, client, tenant_headers, tenant_a):
        response = client.get("/api/v1/sources", headers=tenant_headers(tenant_a))
        assert response.status_code == 200
        assert response.json() == {"items": [], "total": 0, "limit": 50, "offset": 0}

    def test_lists_sources_with_item_shape(self, client, tenant_headers, make_source, tenant_a):
        created = make_source(tenant_a, name="synthetic-console-source")
        response = client.get("/api/v1/sources", headers=tenant_headers(tenant_a))
        assert response.status_code == 200
        body = response.json()
        assert body["total"] == 1
        assert set(body["items"][0]) == SOURCE_KEYS
        assert body["items"][0]["source_id"] == created["source_id"]
        assert body["items"][0]["name"] == "synthetic-console-source"

    def test_tenant_isolation(self, client, tenant_headers, make_source, tenant_a, tenant_b):
        make_source(tenant_a, name="tenant-a-source")
        response = client.get("/api/v1/sources", headers=tenant_headers(tenant_b))
        assert response.status_code == 200
        assert response.json()["total"] == 0

    def test_pagination(self, client, tenant_headers, make_source, tenant_a):
        headers = tenant_headers(tenant_a)
        for i in range(3):
            make_source(tenant_a, name=f"synthetic-source-{i}")
        response = client.get(
            "/api/v1/sources", params={"limit": 2, "offset": 0}, headers=headers
        )
        assert response.json()["total"] == 3
        assert len(response.json()["items"]) == 2
        assert response.json()["limit"] == 2

    def test_evidence_source_resolvable_by_list(
        self, client, tenant_headers, make_source, make_entity, make_evidence, tenant_a
    ):
        """The console joins evidence.source_id against this list — prove the
        source that create_evidence accepted is present here."""
        source = make_source(tenant_a, name="provenance-check-source")
        entity = make_entity(tenant_a)
        evidence = make_evidence(tenant_a, entity["entity_id"], source["source_id"])
        response = client.get("/api/v1/sources", headers=tenant_headers(tenant_a))
        listed_ids = {item["source_id"] for item in response.json()["items"]}
        assert evidence["source_id"] in listed_ids

    def test_missing_tenant_header_rejected(self, client):
        response = client.get("/api/v1/sources")
        assert response.status_code == 400
        assert response.json()["error_code"] == "TENANT_REQUIRED"
