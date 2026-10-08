"""Deterministic threat classification — separate from risk calculation.

Priority order (first match wins, fully deterministic):
1. PHISHING            — domain AND behavioral signals both strong
                         (credential-harvesting pattern: actionable first)
2. BRAND_IMPERSONATION — identity, visual AND text similarity all strong
                         (coordinated identity abuse)
3. SUSPICIOUS_DOMAIN   — domain signals alone are strong
4. UNKNOWN             — none of the above; risk score still stands
"""
from __future__ import annotations

from app.domain.enums import FactorType, ThreatClassification
from app.risk.calculator import ComputedFactor
from app.risk.config import ClassificationThresholds


class ThreatClassifier:
    def __init__(self, thresholds: ClassificationThresholds) -> None:
        self._thresholds = thresholds

    def classify(self, factors: list[ComputedFactor]) -> ThreatClassification:
        scores = {f.factor_type: f.score for f in factors}
        t = self._thresholds

        if (
            scores.get(FactorType.DOMAIN_SIGNALS, 0) >= t.phishing_factor_score
            and scores.get(FactorType.BEHAVIORAL_SIGNALS, 0) >= t.phishing_factor_score
        ):
            return ThreatClassification.PHISHING

        if all(
            scores.get(factor, 0) >= t.impersonation_factor_score
            for factor in (
                FactorType.IDENTITY_SIMILARITY,
                FactorType.VISUAL_SIMILARITY,
                FactorType.TEXT_SIMILARITY,
            )
        ):
            return ThreatClassification.BRAND_IMPERSONATION

        if scores.get(FactorType.DOMAIN_SIGNALS, 0) >= t.suspicious_domain_score:
            return ThreatClassification.SUSPICIOUS_DOMAIN

        return ThreatClassification.UNKNOWN
