"""Module 1 (Brand Intelligence) client boundary.

STATUS: Module 1 does not exist in this repository. The BrandDNA schema in
app/schemas/brand_dna.py is CONTRACT_PROPOSED. This client is the ONLY way
Module 2 touches brand data — never a direct DB import from Module 1.
"""
from __future__ import annotations

from typing import Protocol, runtime_checkable

import httpx

from app.core.errors import IntegrationUnavailableError, MissingBrandDNAError
from app.core.logging import get_logger
from app.schemas.brand_dna import BrandDNA

BRAND_DNA_PATH = "/api/v1/brands/{brand_id}/dna"

logger = get_logger("app.integrations.module1")


@runtime_checkable
class BrandDNAClient(Protocol):
    def get_brand_dna(self, brand_id: str) -> BrandDNA:
        """Fetch canonical brand configuration for similarity anchoring.

        Raises MissingBrandDNAError when the brand is unknown or has no DNA.
        """
        ...


class HTTPBrandDNAClient:
    """Real adapter — requires settings.module1_base_url (EXTERNAL_DEPENDENCY).

    Non-2xx responses never leak upstream bodies to callers; they map to
    typed errors with non-sensitive details only.
    """

    def __init__(self, base_url: str, timeout_seconds: float) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout_seconds

    def get_brand_dna(self, brand_id: str) -> BrandDNA:
        url = f"{self._base_url}{BRAND_DNA_PATH.format(brand_id=brand_id)}"
        try:
            response = httpx.get(url, timeout=self._timeout)
        except httpx.HTTPError as exc:
            logger.warning(
                "module1_unreachable",
                extra={"context": {"url_path": BRAND_DNA_PATH, "error": type(exc).__name__}},
            )
            raise IntegrationUnavailableError("module1", "network_error") from exc
        if response.status_code == 404:
            raise MissingBrandDNAError(brand_id)
        if response.status_code != 200:
            logger.warning(
                "module1_unexpected_status",
                extra={"context": {
                    "status_code": response.status_code,
                    "url_path": BRAND_DNA_PATH,
                }},
            )
            raise IntegrationUnavailableError("module1", f"http_{response.status_code}")
        try:
            payload = response.json()
        except ValueError as exc:
            raise IntegrationUnavailableError("module1", "invalid_json") from exc
        try:
            return BrandDNA.model_validate(payload)
        except ValueError as exc:
            logger.warning(
                "module1_contract_mismatch",
                extra={"context": {"error": type(exc).__name__}},
            )
            raise IntegrationUnavailableError("module1", "contract_mismatch") from exc
