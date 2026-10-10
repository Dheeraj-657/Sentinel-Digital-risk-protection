"""Certificate Transparency discovery via Cert Spotter (public, unauthenticated).

Second CT source alongside crt.sh — same passive signal (names observed in
public certificate logs, derived from Brand DNA official domains), operated
independently. A certificate proves only that the name exists, never that
it is malicious.

Response contract (GET {base}/v1/issuances?domain=<term>&include_subdomains=true&expand=dns_names):
    [ {"id": str, "dns_names": [str, ...], "not_before": str, ...}, ... ]
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

logger = get_logger("app.integrations.discovery.certspotter")

PROVIDER_NAME = "certspotter"


class CertSpotterProvider:
    name = PROVIDER_NAME

    def __init__(
        self,
        base_url: str = "https://api.certspotter.com",
        timeout_seconds: float = 10.0,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout_seconds

    def available(self) -> bool:
        # Public API — anonymous requests permitted within a rate limit.
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
                        url=f"https://{name}/",
                        metadata={"query_term": query.term},
                    )
                )
        return candidates

    def _query_names(self, term: str) -> list[str]:
        """Certificate names observed for the term, registrable-normalized.

        Returns names in log order; the caller caps the count. Failures raise
        DiscoveryProviderError — never a partial silent success.
        """
        url = f"{self._base_url}/v1/issuances"
        try:
            response = httpx.get(
                url,
                params={
                    "domain": term,
                    "include_subdomains": "true",
                    "expand": "dns_names",
                },
                timeout=self._timeout,
                headers={"Accept": "application/json"},
            )
        except httpx.TimeoutException as exc:
            raise DiscoveryProviderError("TIMEOUT", f"certspotter timed out for '{term}'") from exc
        except httpx.HTTPError as exc:
            raise DiscoveryProviderError(
                "FAILED", f"certspotter unreachable for '{term}'"
            ) from exc

        if response.status_code == 429:
            raise DiscoveryProviderError("RATE_LIMITED", "certspotter rate limit (HTTP 429)")
        if response.status_code != 200:
            raise DiscoveryProviderError(
                "FAILED", f"certspotter returned HTTP {response.status_code} for '{term}'"
            )
        try:
            payload = response.json()
        except ValueError as exc:
            raise DiscoveryProviderError(
                "FAILED", f"certspotter returned invalid JSON for '{term}'"
            ) from exc
        if not isinstance(payload, list):
            raise DiscoveryProviderError(
                "FAILED", f"certspotter returned unexpected payload for '{term}'"
            )

        names: list[str] = []
        for entry in payload:
            if not isinstance(entry, dict):
                continue
            dns_names = entry.get("dns_names")
            if not isinstance(dns_names, list):
                continue
            for raw in dns_names:
                if not isinstance(raw, str):
                    continue
                normalized = registrable_domain(raw)
                if normalized is not None:
                    names.append(normalized)
        return names
