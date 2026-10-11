"""SYNTHETIC TEST_ONLY mock discovery provider.

Deterministic, in-memory candidates (or a scripted error) for tests and
local dev. Never used in production wiring — main.py only constructs real
providers; tests bind this one explicitly.
"""
from __future__ import annotations

from datetime import datetime, timezone

from app.integrations.discovery.base import (
    DiscoveryCandidate,
    DiscoveryProviderError,
    DiscoveryQuery,
)
from app.schemas.brand_dna import BrandDNA


class MockDiscoveryProvider:
    def __init__(
        self,
        name: str = "mock",
        *,
        available: bool = True,
        candidates: list[DiscoveryCandidate] | None = None,
        error: DiscoveryProviderError | None = None,
        queries: list[DiscoveryQuery] | None = None,
    ) -> None:
        self.name = name
        self._available = available
        self._candidates = candidates or []
        self._error = error
        self._queries = queries

    def available(self) -> bool:
        return self._available

    def queries_for(self, dna: BrandDNA) -> list[DiscoveryQuery]:
        if self._queries is not None:
            return list(self._queries)
        return [
            DiscoveryQuery(
                term=dna.identity.name, basis=f"brand_name:{dna.identity.name}"
            )
        ]

    def discover(
        self, queries: list[DiscoveryQuery], max_results: int
    ) -> list[DiscoveryCandidate]:
        if self._error is not None:
            raise self._error
        return list(self._candidates)[:max_results]


def synthetic_candidate(
    provider: str,
    *,
    domain: str | None = None,
    url: str | None = None,
    title: str | None = None,
    snippet: str | None = None,
    kind: str = "search_result",
    query_basis: str = "brand_name:SYNTHETIC",
) -> DiscoveryCandidate:
    """SYNTHETIC TEST_ONLY candidate factory for tests."""
    return DiscoveryCandidate(
        provider=provider,
        kind=kind,
        query_basis=query_basis,
        observed_at=datetime.now(timezone.utc),
        domain=domain,
        url=url,
        title=title,
        snippet=snippet,
    )
