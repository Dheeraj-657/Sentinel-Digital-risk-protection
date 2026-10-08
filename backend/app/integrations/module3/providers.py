"""Module 3 (Digital Intelligence) provider boundaries.

STATUS: Module 3 does not exist in this repository. EntityReference /
EvidenceReference DTOs are CONTRACT_PROPOSED. Module 2 retrieves entity and
evidence data ONLY through these providers — it never scrapes, crawls, or
ingests, and never persists copies of Module 3 aggregates.
"""
from __future__ import annotations

from typing import Protocol, runtime_checkable

import httpx

from app.core.errors import IntegrationUnavailableError, InvalidEntityError
from app.core.logging import get_logger
from app.schemas.entity import EntityReference, EvidenceReference

logger = get_logger("app.integrations.module3")

ENTITY_PATH = "/api/v1/entities/{entity_id}"
ENTITY_EVIDENCE_PATH = "/api/v1/entities/{entity_id}/evidence"


@runtime_checkable
class EntityProvider(Protocol):
    def get_entity(self, tenant_id: str, entity_id: str) -> EntityReference:
        """Fetch the normalized entity to analyze.

        Raises InvalidEntityError when the entity does not exist or does not
        belong to the tenant (tenant isolation enforced at the boundary).
        """
        ...


@runtime_checkable
class EvidenceProvider(Protocol):
    def list_evidence(self, tenant_id: str, entity_id: str) -> list[EvidenceReference]:
        """List evidence items Module 2 may score for this entity."""
        ...


class HTTPModule3Client:
    """Real adapter — requires settings.module3_base_url (EXTERNAL_DEPENDENCY).

    Sends X-Tenant-ID downstream so Module 3 can enforce isolation; a 404 or
    403 from downstream is uniformly mapped to InvalidEntityError so callers
    cannot distinguish existence from cross-tenant access.
    """

    def __init__(self, base_url: str, timeout_seconds: float) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout_seconds

    def get_entity(self, tenant_id: str, entity_id: str) -> EntityReference:
        url = f"{self._base_url}{ENTITY_PATH.format(entity_id=entity_id)}"
        try:
            response = httpx.get(url, timeout=self._timeout, headers={"X-Tenant-ID": tenant_id})
        except httpx.HTTPError as exc:
            logger.warning(
                "module3_unreachable",
                extra={"context": {"error": type(exc).__name__}},
            )
            raise IntegrationUnavailableError("module3", "network_error") from exc
        if response.status_code in (403, 404):
            raise InvalidEntityError(entity_id)
        if response.status_code != 200:
            logger.warning(
                "module3_unexpected_status",
                extra={"context": {"status_code": response.status_code}},
            )
            raise IntegrationUnavailableError("module3", f"http_{response.status_code}")
        try:
            payload = response.json()
        except ValueError as exc:
            raise IntegrationUnavailableError("module3", "invalid_json") from exc
        try:
            return EntityReference.model_validate(payload)
        except ValueError as exc:
            logger.warning(
                "module3_contract_mismatch",
                extra={"context": {"error": type(exc).__name__}},
            )
            raise IntegrationUnavailableError("module3", "contract_mismatch") from exc

    def list_evidence(self, tenant_id: str, entity_id: str) -> list[EvidenceReference]:
        url = f"{self._base_url}{ENTITY_EVIDENCE_PATH.format(entity_id=entity_id)}"
        try:
            response = httpx.get(url, timeout=self._timeout, headers={"X-Tenant-ID": tenant_id})
        except httpx.HTTPError as exc:
            logger.warning(
                "module3_unreachable",
                extra={"context": {"error": type(exc).__name__}},
            )
            raise IntegrationUnavailableError("module3", "network_error") from exc
        if response.status_code in (403, 404):
            raise InvalidEntityError(entity_id)
        if response.status_code != 200:
            logger.warning(
                "module3_unexpected_status",
                extra={"context": {"status_code": response.status_code}},
            )
            raise IntegrationUnavailableError("module3", f"http_{response.status_code}")
        try:
            payload = response.json()
        except ValueError as exc:
            raise IntegrationUnavailableError("module3", "invalid_json") from exc
        try:
            return [EvidenceReference.model_validate(item) for item in payload]
        except (ValueError, TypeError) as exc:
            logger.warning(
                "module3_contract_mismatch",
                extra={"context": {"error": type(exc).__name__}},
            )
            raise IntegrationUnavailableError("module3", "contract_mismatch") from exc
