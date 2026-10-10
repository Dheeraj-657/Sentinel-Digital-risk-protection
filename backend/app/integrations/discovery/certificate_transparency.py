"""Certificate Transparency discovery via crt.sh (public, unauthenticated).

crt.sh exposes an HTTPS JSON log endpoint; queries are bounded to the
brand's own registrable domains taken from Brand DNA. Newly issued
certificates for lookalike domains are a standard, passive source of
candidate discovery — a certificate proves only that the domain exists,
never that it is malicious.

Response contract (GET {base}/?q=<term>&output=json&exclude=expired):
    [ {"issuer_name": str, "common_name": str, "name_value": "a\\nb",
       "not_before": str, "entry_timestamp": str, ...}, ... ]
Any shape drift is mapped to FAILED("invalid_response") — upstream bodies
never leak raw to callers.
"""
from __future__ import annotations

from datetime import datetime, timezone

import httpx

from app.core.logging import get_logger
from app.integrations.discovery.base import (
    DiscoveryCandidate,
    DiscoveryProviderError,
    DiscoveryQuery,
)
from app.schemas.brand_dna import BrandDNA
from app.services.normalization import registrable_domain

logger = get_logger("app.integrations.discovery.ct")

PROVIDER_NAME = "certificate_transparency"


class CertificateTransparencyProvider:
    name = PROVIDER_NAME

    def __init__(self, base_url: str = "https://crt.sh", timeout_seconds: float = 10.0) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout_seconds

    def available(self) -> bool:
        # Public log endpoint — no credentials required.
        return True

    def queries_for(self, dna: BrandDNA) -> list[DiscoveryQuery]:
        """One CT query per unique official registrable domain (bounded by
        the caller). Basis records which official domain produced the term."""
        queries: list[DiscoveryQuery] = []
        seen: set[str] = set()
        for brand_domain in dna.domains:
            registrable = registrable_domain(brand_domain.domain)
            if registrable is None or registrable in seen:
                continue
            seen.add(registrable)
            queries.append(
                DiscoveryQuery(term=registrable, basis=f"official_domain:{registrable}")
            )
        return queries

    def discover(
        self, queries: list[DiscoveryQuery], max_results: int
    ) -> list[DiscoveryCandidate]:
        observed_at = datetime.now(timezone.utc)
        candidates: list[DiscoveryCandidate] = []
        seen_names: set[str] = set()
        for query in queries:
            for name in self._query_names(query.term):
                if name in seen_names:
                    continue
                seen_names.add(name)
                if len(candidates) >= max_results:
                    return candidates
                candidates.append(
                    DiscoveryCandidate(
                        provider=self.name,
                        kind="certificate",
                        query_basis=query.basis,
                        observed_at=observed_at,
                        domain=name,
                        url=f"{self._base_url}/?q={name}",
                        metadata={"common_name_source": name, "query_term": query.term},
                    )
                )
        return candidates

    def _query_names(self, term: str) -> list[str]:
        """Certificate names observed for the term, registrable-normalized.

        Returns names in log order (newest first in practice); the caller
        caps the count. Failures raise DiscoveryProviderError — never a
        partial silent success.
        """
        url = f"{self._base_url}/"
        try:
            response = httpx.get(
                url,
                params={"q": term, "output": "json", "exclude": "expired"},
                timeout=self._timeout,
                headers={"Accept": "application/json"},
            )
        except httpx.TimeoutException as exc:
            raise DiscoveryProviderError("TIMEOUT", f"crt.sh timed out for '{term}'") from exc
        except httpx.HTTPStatusError as exc:  # pragma: no cover — httpx.get does not raise this
            raise DiscoveryProviderError("FAILED", f"crt.sh http error for '{term}'") from exc
        except httpx.HTTPError as exc:
            raise DiscoveryProviderError("FAILED", f"crt.sh unreachable for '{term}'") from exc

        if response.status_code == 429:
            raise DiscoveryProviderError("RATE_LIMITED", "crt.sh rate limit (HTTP 429)")
        if response.status_code != 200:
            raise DiscoveryProviderError(
                "FAILED", f"crt.sh returned HTTP {response.status_code} for '{term}'"
            )
        try:
            payload = response.json()
        except ValueError as exc:
            raise DiscoveryProviderError(
                "FAILED", f"crt.sh returned invalid JSON for '{term}'"
            ) from exc
        if not isinstance(payload, list):
            raise DiscoveryProviderError(
                "FAILED", f"crt.sh returned unexpected payload for '{term}'"
            )

        names: list[str] = []
        for entry in payload:
            if not isinstance(entry, dict):
                continue
            common_name = entry.get("common_name")
            name_value = entry.get("name_value")
            raw_names: list[str] = []
            if isinstance(common_name, str):
                raw_names.append(common_name)
            if isinstance(name_value, str):
                raw_names.extend(name_value.split("\n"))
            for raw in raw_names:
                normalized = registrable_domain(raw)
                if normalized is not None:
                    names.append(normalized)
        return names
