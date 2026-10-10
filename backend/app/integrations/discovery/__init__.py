"""Discovery provider boundary — where threat candidates come from.

Providers are read-only observers of public/permitted data sources. They
return DiscoveryCandidate observations; they never assert malice. All
normalization, deduplication, official-domain exclusion and Module 3
persistence happens in app.services.discovery.
"""
from app.integrations.discovery.base import (
    STATUS_COMPLETED,
    STATUS_EMPTY,
    STATUS_FAILED,
    STATUS_RATE_LIMITED,
    STATUS_TIMEOUT,
    STATUS_UNCONFIGURED,
    DiscoveryCandidate,
    DiscoveryProviderError,
    DiscoveryQuery,
    ProviderOutcome,
)
from app.integrations.discovery.certificate_transparency import (
    CertificateTransparencyProvider,
)
from app.integrations.discovery.mock import MockDiscoveryProvider
from app.integrations.discovery.search_api import SearchApiProvider

__all__ = [
    "STATUS_COMPLETED",
    "STATUS_EMPTY",
    "STATUS_FAILED",
    "STATUS_RATE_LIMITED",
    "STATUS_TIMEOUT",
    "STATUS_UNCONFIGURED",
    "CertificateTransparencyProvider",
    "DiscoveryCandidate",
    "DiscoveryProviderError",
    "DiscoveryQuery",
    "MockDiscoveryProvider",
    "ProviderOutcome",
    "SearchApiProvider",
]
