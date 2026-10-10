from __future__ import annotations

from enum import Enum


class RiskLevel(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class JobStatus(str, Enum):
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class DiscoveryJobStatus(str, Enum):
    """Lifecycle of a brand discovery job.

    COMPLETED — every queried provider returned a verdict (including EMPTY).
    PARTIAL   — at least one provider succeeded and at least one failed.
    FAILED    — every provider failed, or the job failed outright (e.g. the
                brand DNA was unavailable).
    """

    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    PARTIAL = "PARTIAL"
    FAILED = "FAILED"


class FactorType(str, Enum):
    IDENTITY_SIMILARITY = "IDENTITY_SIMILARITY"
    TEXT_SIMILARITY = "TEXT_SIMILARITY"
    VISUAL_SIMILARITY = "VISUAL_SIMILARITY"
    DOMAIN_SIGNALS = "DOMAIN_SIGNALS"
    BEHAVIORAL_SIGNALS = "BEHAVIORAL_SIGNALS"
    REPUTATION_SIGNALS = "REPUTATION_SIGNALS"
    RELATIONSHIP_SIGNALS = "RELATIONSHIP_SIGNALS"


class EvidenceBasis(str, Enum):
    """How a conclusion was reached — never present predictions as facts."""

    OBSERVED = "OBSERVED"
    DERIVED = "DERIVED"
    INFERRED = "INFERRED"
    PREDICTED = "PREDICTED"


class ThreatStatus(str, Enum):
    """Threat lifecycle inside the risk engine.

    CONFIRMED / DISMISSED transitions are driven by Module 4's analyst
    workflow through PATCH /api/v1/threats/{threat_id}/status; the workflow
    itself (approvals, tasks) is owned by Module 4.
    """

    OPEN = "OPEN"
    CONFIRMED = "CONFIRMED"
    DISMISSED = "DISMISSED"


class ThreatClassification(str, Enum):
    BRAND_IMPERSONATION = "BRAND_IMPERSONATION"
    PHISHING = "PHISHING"
    SUSPICIOUS_DOMAIN = "SUSPICIOUS_DOMAIN"
    UNKNOWN = "UNKNOWN"


class EntityType(str, Enum):
    """Normalized digital entity types (owned by Module 3; referenced here)."""

    SOCIAL_PROFILE = "SOCIAL_PROFILE"
    WEBSITE = "WEBSITE"
    DOMAIN = "DOMAIN"
    MOBILE_APP = "MOBILE_APP"
    MESSAGING_ACCOUNT = "MESSAGING_ACCOUNT"
    OTHER = "OTHER"


class EvidenceType(str, Enum):
    """Categories of evidence Module 2 consumes (owned by Module 3)."""

    IDENTITY_MATCH = "IDENTITY_MATCH"
    TEXT_CONTENT = "TEXT_CONTENT"
    VISUAL_ASSET = "VISUAL_ASSET"
    DOMAIN_INTEL = "DOMAIN_INTEL"
    BEHAVIORAL_EVENT = "BEHAVIORAL_EVENT"
    REPUTATION_INTEL = "REPUTATION_INTEL"
    RELATIONSHIP_LINK = "RELATIONSHIP_LINK"
