"""Web search discovery via a configurable search API (Brave Search shape).

Requires an API key via settings.discovery_search_api_key. Without one the
provider reports UNCONFIGURED — no fabricated results, ever. Queries derive
from Brand DNA: the brand name (optionally scoped to impersonation-prone
phrasings) and official social handles.

Response contract (GET {base}?q=<term>&count=<n>, header X-Subscription-Token):
    {"data": {"web": {"results": [{"url": str, "title": str,
                                   "description": str}, ...]}}}
Any shape drift is mapped to FAILED("invalid_response").
"""
from __future__ import annotations

from datetime import datetime, timezone
from urllib.parse import urlparse

import httpx

from app.core.logging import get_logger
from app.integrations.discovery.base import (
    DiscoveryCandidate,
    DiscoveryProviderError,
    DiscoveryQuery,
)
from app.schemas.brand_dna import BrandDNA
from app.services.normalization import normalize_handle, registrable_domain

logger = get_logger("app.integrations.discovery.search")

PROVIDER_NAME = "web_search"

_SEARCH_SUFFIXES = ("", " login")


class SearchApiProvider:
    name = PROVIDER_NAME

    def __init__(
        self,
        api_key: str | None,
        base_url: str = "https://api.search.brave.com/res/v1/web/search",
        timeout_seconds: float = 10.0,
    ) -> None:
        self._api_key = api_key or None
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout_seconds

    def available(self) -> bool:
        return self._api_key is not None

    def queries_for(self, dna: BrandDNA) -> list[DiscoveryQuery]:
        """Bounded query set: brand name (plus impersonation-phrasings) and
        official handles. Basis records the DNA signal that produced it."""
        queries: list[DiscoveryQuery] = []
        name = dna.identity.name.strip()
        if name:
            for suffix in _SEARCH_SUFFIXES:
                term = f"{name} {suffix}".strip()
                basis = "brand_name:" + name + (f" suffix:{suffix}" if suffix else "")
                queries.append(DiscoveryQuery(term=term, basis=basis))
        seen_handles: set[str] = set()
        for profile in dna.social_profiles:
            handle = normalize_handle(profile.handle)
            if not handle or handle in seen_handles:
                continue
            seen_handles.add(handle)
            queries.append(
                DiscoveryQuery(term=handle, basis=f"handle:{profile.handle}")
            )
        return queries

    def discover(
        self, queries: list[DiscoveryQuery], max_results: int
    ) -> list[DiscoveryCandidate]:
        observed_at = datetime.now(timezone.utc)
        candidates: list[DiscoveryCandidate] = []
        seen_urls: set[str] = set()
        for query in queries:
            for hit in self._search(query.term, max_results):
                url = (hit.get("url") or "").strip()
                if not url or url in seen_urls:
                    continue
                seen_urls.add(url)
                host = registrable_domain(urlparse(url).hostname or "")
                if len(candidates) >= max_results:
                    return candidates
                candidates.append(
                    DiscoveryCandidate(
                        provider=self.name,
                        kind="search_result",
                        query_basis=query.basis,
                        observed_at=observed_at,
                        domain=host or None,
                        url=url,
                        title=hit.get("title") or None,
                        snippet=hit.get("description") or None,
                        metadata={"query_term": query.term},
                    )
                )
        return candidates

    def _search(self, term: str, count: int) -> list[dict]:
        try:
            response = httpx.get(
                self._base_url,
                params={"q": term, "count": min(max(count, 1), 20)},
                timeout=self._timeout,
                headers={
                    "X-Subscription-Token": self._api_key or "",
                    "Accept": "application/json",
                },
            )
        except httpx.TimeoutException as exc:
            raise DiscoveryProviderError("TIMEOUT", f"search API timed out for '{term}'") from exc
        except httpx.HTTPError as exc:
            raise DiscoveryProviderError(
                "FAILED", f"search API unreachable for '{term}'"
            ) from exc

        if response.status_code == 429:
            raise DiscoveryProviderError("RATE_LIMITED", "search API rate limit (HTTP 429)")
        if response.status_code != 200:
            raise DiscoveryProviderError(
                "FAILED", f"search API returned HTTP {response.status_code} for '{term}'"
            )
        try:
            payload = response.json()
        except ValueError as exc:
            raise DiscoveryProviderError(
                "FAILED", f"search API returned invalid JSON for '{term}'"
            ) from exc
        try:
            results = payload["data"]["web"]["results"]
        except (KeyError, TypeError) as exc:
            raise DiscoveryProviderError(
                "FAILED", f"search API returned unexpected payload for '{term}'"
            ) from exc
        if not isinstance(results, list):
            raise DiscoveryProviderError(
                "FAILED", f"search API returned unexpected payload for '{term}'"
            )
        return [hit for hit in results if isinstance(hit, dict)]
