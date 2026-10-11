"""Centralized, versioned risk engine configuration.

The ONLY home of factor weights, level thresholds, and evidence minimums.
Changing semantics means shipping a new engine_version — historical
AnalysisResults stay interpretable because they persist the version that
produced them.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from app.domain.enums import FactorType, RiskLevel

ENGINE_VERSION = "1.0.0"


@dataclass(frozen=True)
class RiskLevelThresholds:
    """risk <= low_max → LOW; <= medium_max → MEDIUM; <= high_max → HIGH; else CRITICAL."""

    low_max: int = 25
    medium_max: int = 50
    high_max: int = 75


@dataclass(frozen=True)
class ClassificationThresholds:
    """Deterministic classification rules; scores are factor scores (0-100)."""

    impersonation_factor_score: int = 70
    phishing_factor_score: int = 65
    suspicious_domain_score: int = 70


@dataclass(frozen=True)
class RiskEngineConfig:
    engine_version: str = ENGINE_VERSION
    factor_weights: dict[FactorType, float] = field(
        default_factory=lambda: {
            FactorType.IDENTITY_SIMILARITY: 0.20,
            FactorType.TEXT_SIMILARITY: 0.15,
            FactorType.VISUAL_SIMILARITY: 0.20,
            FactorType.DOMAIN_SIGNALS: 0.15,
            FactorType.BEHAVIORAL_SIGNALS: 0.10,
            FactorType.REPUTATION_SIGNALS: 0.10,
            FactorType.RELATIONSHIP_SIGNALS: 0.10,
        }
    )
    level_thresholds: RiskLevelThresholds = field(default_factory=RiskLevelThresholds)
    classification_thresholds: ClassificationThresholds = field(
        default_factory=ClassificationThresholds
    )
    minimum_evidence_per_factor: int = 1
    minimum_total_evidence: int = 1

    def validate(self) -> None:
        weights = self.factor_weights
        missing = set(FactorType) - set(weights)
        if missing:
            raise ValueError(f"factor_weights missing entries: {sorted(m.name for m in missing)}")
        total = sum(weights.values())
        if abs(total - 1.0) > 1e-9:
            raise ValueError(f"factor_weights must sum to 1.0, got {total}")
        t = self.level_thresholds
        if not (0 <= t.low_max < t.medium_max < t.high_max <= 100):
            raise ValueError("level thresholds must satisfy 0 <= low < medium < high <= 100")


DEFAULT_RISK_ENGINE_CONFIG = RiskEngineConfig()
DEFAULT_RISK_ENGINE_CONFIG.validate()
