"""Provider protocol and outcome vocabulary for threat discovery.

Per-provider outcome statuses (never collapsed into a generic failure —
the console surfaces them individually):
    COMPLETED     — provider returned results.
    EMPTY         — provider ran cleanly and found nothing.
    UNCONFIGURED  — provider requires credentials and none are set. No
                    results are invented to fill the gap.
    TIMEOUT       — the provider did not answer within the budget.
    RATE_LIMITED  — the provider asked us to slow down (HTTP 429).
    FAILED        — any other provider-side failure (bad status, invalid
                    payload, transport error).
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Protocol, runtime_checkable

from pydantic import BaseModel, Field

from app.schemas.brand_dna import BrandDNA

STATUS_COMPLETED = "COMPLETED"
STATUS_EMPTY = "EMPTY"
STATUS_UNCONFIGURED = "UNCONFIGURED"
STATUS_TIMEOUT = "TIMEOUT"
STATUS_RATE_LIMITED = "RATE_LIMITED"
STATUS_FAILED = "FAILED"

FAILURE_STATUSES = {STATUS_TIMEOUT, STATUS_RATE_LIMITED, STATUS_FAILED}
SUCCESS_STATUSES = {STATUS_COMPLETED, STATUS_EMPTY}


class DiscoveryQuery(BaseModel):
    """One lookup derived from Brand DNA.

    basis documents WHY the term was queried, e.g.
    "official_domain:acme.com", "brand_name:Acme Corp", "handle:@acme_help".
    """

    model_config = {"frozen": True}

    term: str = Field(min_length=1)
    basis: str = Field(min_length=1)


class DiscoveryCandidate(BaseModel):
    """One raw provider observation, before normalization/deduplication.

    domain/url identify the observation; metadata carries provider-native
    detail. Nothing here implies the observed target is malicious.
    """

    model_config = {"frozen": True}

    provider: str
    kind: str = Field(description="'certificate' or 'search_result'")
    query_basis: str
    observed_at: datetime
    domain: str | None = None
    url: str | None = None
    title: str | None = None
    snippet: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class ProviderOutcome(BaseModel):
    """Verdict of one provider for one discovery run. Serialized into the
    DiscoveryJob row so the console can show provider coverage honestly."""

    provider: str
    status: str
    candidate_count: int = 0
    warning: str | None = None
    error: str | None = None
    latency_ms: int | None = None


class DiscoveryProviderError(Exception):
    """Raised by a provider when it cannot complete. `status` is one of
    STATUS_TIMEOUT / STATUS_RATE_LIMITED / STATUS_FAILED."""

    def __init__(self, status: str, detail: str) -> None:
        super().__init__(f"{status}: {detail}")
        self.status = status
        self.detail = detail


@runtime_checkable
class DiscoveryProvider(Protocol):
    """A bounded, read-only source of threat candidates.

    available() must be cheap and side-effect free (credential check). A
    provider that is not available is reported UNCONFIGURED — discover() is
    never called for it.
    """

    name: str

    def available(self) -> bool: ...

    def queries_for(self, dna: BrandDNA) -> list[DiscoveryQuery]:
        """Derive this provider's bounded query set from Brand DNA."""
        ...

    def discover(
        self, queries: list[DiscoveryQuery], max_results: int
    ) -> list[DiscoveryCandidate]:
        """Run the queries. Must raise DiscoveryProviderError on failure and
        return at most max_results candidates."""
        ...
