"""Module 3 write boundary — sources, entities, evidence creation.

Module 2 discovery persists its observations AS Module 3 records so all
evidence remains traceable and tenant-scoped in the system of record.
Mirrors the read-adapter error conventions in providers.py: network/shape
failures raise IntegrationUnavailableError; a 409 DUPLICATE_ENTITY is
surfaced as EntityAlreadyExistsError carrying the existing entity_id.
"""
from __future__ import annotations

import uuid
from typing import Any

import httpx

from app.core.errors import EntityAlreadyExistsError, IntegrationUnavailableError
from app.core.logging import get_logger

logger = get_logger("app.integrations.module3.writer")

SOURCE_PATH = "/api/v1/sources"
ENTITY_PATH = "/api/v1/entities"
EVIDENCE_PATH = "/api/v1/entities/{entity_id}/evidence"


class Module3Writer:
    def __init__(self, base_url: str, timeout_seconds: float = 10.0) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout_seconds

    def create_source(self, tenant_id: str, name: str, kind: str) -> uuid.UUID:
        payload = self._post(
            SOURCE_PATH, tenant_id, {"name": name, "kind": kind}, "source"
        )
        return uuid.UUID(str(payload["source_id"]))

    def create_entity(
        self,
        tenant_id: str,
        *,
        entity_type: str,
        display_name: str | None,
        identifiers: dict[str, str],
        attributes: dict[str, Any],
        entity_id: uuid.UUID | None = None,
    ) -> uuid.UUID:
        body: dict[str, Any] = {
            "entity_type": entity_type,
            "display_name": display_name,
            "identifiers": identifiers,
            "attributes": attributes,
        }
        if entity_id is not None:
            body["entity_id"] = str(entity_id)
        try:
            payload = self._post(ENTITY_PATH, tenant_id, body, "entity")
        except IntegrationUnavailableError as exc:
            existing = exc.details.get("existing_entity_id")
            if exc.details.get("reason") == "http_409" and existing:
                raise EntityAlreadyExistsError(str(existing)) from exc
            raise
        return uuid.UUID(str(payload["entity_id"]))

    def create_evidence(
        self,
        tenant_id: str,
        entity_id: uuid.UUID,
        *,
        source_id: uuid.UUID,
        evidence_type: str,
        collected_at: str,
        text: str | None = None,
        image_hash: str | None = None,
        url: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> uuid.UUID:
        payload = self._post(
            EVIDENCE_PATH.format(entity_id=entity_id),
            tenant_id,
            {
                "source_id": str(source_id),
                "evidence_type": evidence_type,
                "collected_at": collected_at,
                "text": text,
                "image_hash": image_hash,
                "url": url,
                "metadata": metadata or {},
            },
            "evidence",
        )
        return uuid.UUID(str(payload["evidence_id"]))

    def _post(
        self, path: str, tenant_id: str, body: dict[str, Any], what: str
    ) -> dict[str, Any]:
        url = f"{self._base_url}{path}"
        try:
            response = httpx.post(
                url,
                json=body,
                timeout=self._timeout,
                headers={"X-Tenant-ID": tenant_id, "Accept": "application/json"},
            )
        except httpx.TimeoutException as exc:
            logger.warning("module3_writer_timeout", extra={"context": {"what": what}})
            raise IntegrationUnavailableError("module3", "timeout") from exc
        except httpx.HTTPError as exc:
            logger.warning(
                "module3_writer_unreachable",
                extra={"context": {"what": what, "error": type(exc).__name__}},
            )
            raise IntegrationUnavailableError("module3", "network_error") from exc

        if response.status_code == 409:
            # Module 3 echoes the conflicting key in details.existing_entity_id.
            existing: str | None = None
            try:
                existing = (
                    response.json().get("details", {}).get("existing_entity_id")
                )
            except ValueError:
                pass
            logger.warning("module3_writer_conflict", extra={"context": {"what": what}})
            error = IntegrationUnavailableError("module3", "http_409")
            error.details["existing_entity_id"] = existing
            raise error
        if response.status_code not in (200, 201):
            logger.warning(
                "module3_writer_unexpected_status",
                extra={"context": {"what": what, "status_code": response.status_code}},
            )
            raise IntegrationUnavailableError("module3", f"http_{response.status_code}")
        try:
            payload = response.json()
        except ValueError as exc:
            raise IntegrationUnavailableError("module3", "invalid_json") from exc
        if not isinstance(payload, dict):
            raise IntegrationUnavailableError("module3", "invalid_json")
        return payload
