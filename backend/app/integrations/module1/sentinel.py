"""Module 1 adapter: Sentinel DRP (teammate's Next.js brand service).

Maps Sentinel's REAL wire contract onto Module 2's BrandDNA schema. All
shape adaptation lives at this boundary — Module 2's pipeline code,
schemas and database are untouched (resolutions C-01/C-02 in
docs/modules/module-2/INTEGRATION_CONFLICT_ANALYSIS.md).

Wire contract (read from Sentinel's source, not assumed):
    GET {base}/api/brands -> {"items": [BrandItem, ...]}
    BrandItem = {id: cuid-string, name, officialDomains: [str],
                 officialHandles: [str], appDevelopers: [str],
                 packagePrefixes: [str], keywords: [str], isDemo: bool,
                 scanCount: int}
Sentinel exposes no per-brand GET and no /dna endpoint; the adapter lists
and selects by identifier.

Field mapping:
    brand_id   <- uuid5(SENTINEL_BRAND_NAMESPACE, id). Module 2 keys brands
                 by UUID (API, jobs, threats, DB constraints); the uuid5
                 bridge is deterministic, so callers can derive the UUID
                 from the Sentinel id via sentinel_cuid_to_brand_uuid().
                 The raw cuid string is also accepted.
    version    <- SENTINEL_BRAND_VERSION. HONEST LIMITATION: Sentinel's
                 list payload omits updatedAt, so this is a constant
                 marker, not a freshness signal.
    domains / verification.verified_domains    <- officialDomains
    verification.verified_social_handles       <- officialHandles
    identity.aliases <- []. Sentinel's `keywords` are abuse-detection
                 vocabulary, NOT brand aliases; mapping them would
                 inflate text-similarity scores.
    social_profiles / visual_assets / text_signals <- []. Not modeled by
                 Sentinel; empty means honestly absent, never fabricated.
    appDevelopers / packagePrefixes / isDemo / scanCount: dropped at this
                 boundary — no Module 2 consumer exists.

Error mapping matches the Module 1 convention; upstream bodies never
leak to callers:
    brand absent from list    -> MissingBrandDNAError (HTTP 424)
    non-200 status            -> IntegrationUnavailableError("module1", "http_NNN")
    invalid JSON              -> IntegrationUnavailableError("module1", "invalid_json")
    shape drift               -> IntegrationUnavailableError("module1", "contract_mismatch")
    transport failure/timeout -> IntegrationUnavailableError("module1", "network_error")
"""
from __future__ import annotations

import uuid

import httpx

from app.core.errors import IntegrationUnavailableError, MissingBrandDNAError
from app.core.logging import get_logger
from app.schemas.brand_dna import (
    BrandDNA,
    BrandDomain,
    BrandIdentity,
    BrandVerification,
)

SENTINEL_BRANDS_PATH = "/api/brands"
SENTINEL_BRAND_NAMESPACE = uuid.uuid5(uuid.NAMESPACE_DNS, "trustgraph.module1.sentinel")
SENTINEL_BRAND_VERSION = "sentinel-unversioned"

logger = get_logger("app.integrations.module1.sentinel")


def sentinel_cuid_to_brand_uuid(sentinel_cuid: str) -> uuid.UUID:
    """Deterministic bridge: Sentinel cuid -> Module 2 brand UUID."""
    return uuid.uuid5(SENTINEL_BRAND_NAMESPACE, sentinel_cuid)


class SentinelBrandClient:
    """BrandDNAClient against Sentinel's GET /api/brands list endpoint.

    Requires settings.module1_base_url (EXTERNAL_DEPENDENCY). Selection is
    by derived UUID (production path — Module 2 always passes str(UUID))
    or by the raw Sentinel id string.
    """

    def __init__(self, base_url: str, timeout_seconds: float = 10.0) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout_seconds

    def get_brand_dna(self, brand_id: str) -> BrandDNA:
        item = self._select(self._fetch_items(), brand_id)
        if item is None:
            raise MissingBrandDNAError(brand_id)
        return self._map_item(item)

    def _fetch_items(self) -> list:
        url = f"{self._base_url}{SENTINEL_BRANDS_PATH}"
        try:
            response = httpx.get(url, timeout=self._timeout)
        except httpx.HTTPError as exc:
            logger.warning(
                "module1_unreachable",
                extra={"context": {"url_path": SENTINEL_BRANDS_PATH, "error": type(exc).__name__}},
            )
            raise IntegrationUnavailableError("module1", "network_error") from exc
        if response.status_code != 200:
            logger.warning(
                "module1_unexpected_status",
                extra={"context": {
                    "status_code": response.status_code,
                    "url_path": SENTINEL_BRANDS_PATH,
                }},
            )
            raise IntegrationUnavailableError("module1", f"http_{response.status_code}")
        try:
            payload = response.json()
        except ValueError as exc:
            raise IntegrationUnavailableError("module1", "invalid_json") from exc
        if not isinstance(payload, dict) or not isinstance(payload.get("items"), list):
            raise IntegrationUnavailableError("module1", "contract_mismatch")
        return payload["items"]

    @staticmethod
    def _select(items: list, brand_id: str) -> dict | None:
        """Find the brand by derived UUID or raw id; skip unidentifiable
        rows so one malformed entry cannot break every brand lookup."""
        try:
            wanted = uuid.UUID(str(brand_id))
        except ValueError:
            wanted = None
        for item in items:
            if not isinstance(item, dict):
                continue
            item_id = item.get("id")
            if not isinstance(item_id, str):
                continue
            if item_id == brand_id:
                return item
            if wanted is not None and sentinel_cuid_to_brand_uuid(item_id) == wanted:
                return item
        return None

    def _map_item(self, item: dict) -> BrandDNA:
        item_id = item.get("id")
        if not isinstance(item_id, str):
            raise IntegrationUnavailableError("module1", "contract_mismatch")
        domains = self._string_list(item, "officialDomains")
        handles = self._string_list(item, "officialHandles")
        try:
            return BrandDNA(
                brand_id=sentinel_cuid_to_brand_uuid(item_id),
                version=SENTINEL_BRAND_VERSION,
                identity=BrandIdentity(name=item["name"]),
                domains=[BrandDomain(domain=d) for d in domains],
                verification=BrandVerification(
                    verified_domains=domains,
                    verified_social_handles=handles,
                ),
            )
        except (KeyError, TypeError, ValueError):
            logger.warning(
                "module1_contract_mismatch",
                extra={"context": {"error": "brand_item_shape"}},
            )
            raise IntegrationUnavailableError("module1", "contract_mismatch")

    @staticmethod
    def _string_list(item: dict, field: str) -> list[str]:
        value = item.get(field, [])
        if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
            raise IntegrationUnavailableError("module1", "contract_mismatch")
        return value
