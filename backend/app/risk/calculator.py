"""Deterministic risk calculation.

contribution = score × weight   (score 0-100, weight 0-1 → contribution 0-100)
total        = Σ contributions, clamped to [0, 100], rounded half-up to INTEGER.

Intermediate floats are never rounded; only the final aggregate is.
Factors are omitted (not zero-scored) when a factor has no evidence — the
pipeline never fabricates a factor to fill the weight table.
"""
from __future__ import annotations

from dataclasses import dataclass

from app.domain.enums import EvidenceBasis, FactorType, RiskLevel
from app.risk.config import RiskEngineConfig


@dataclass(frozen=True)
class FactorInput:
    """A factor candidate produced by the similarity/signal layers."""

    factor_type: FactorType
    score: int
    confidence: float
    evidence_ids: tuple[str, ...]
    basis: EvidenceBasis = EvidenceBasis.OBSERVED


@dataclass(frozen=True)
class ComputedFactor:
    """Explainability unit persisted as a RiskFactor row."""

    factor_type: FactorType
    score: int
    weight: float
    contribution: float
    confidence: float
    basis: EvidenceBasis
    evidence_ids: tuple[str, ...]


@dataclass(frozen=True)
class RiskBreakdown:
    factors: tuple[ComputedFactor, ...]
    total_score: int
    level: RiskLevel
    confidence: float
    engine_version: str


class RiskCalculator:
    def __init__(self, config: RiskEngineConfig) -> None:
        config.validate()
        self._config = config

    @property
    def config(self) -> RiskEngineConfig:
        return self._config

    def compute(self, factor_inputs: list[FactorInput]) -> RiskBreakdown:
        computed: list[ComputedFactor] = []
        for factor in factor_inputs:
            if len(factor.evidence_ids) < self._config.minimum_evidence_per_factor:
                continue
            weight = self._config.factor_weights[factor.factor_type]
            score = max(0, min(100, int(factor.score)))
            computed.append(
                ComputedFactor(
                    factor_type=factor.factor_type,
                    score=score,
                    weight=weight,
                    contribution=score * weight,
                    confidence=max(0.0, min(1.0, factor.confidence)),
                    basis=factor.basis,
                    evidence_ids=factor.evidence_ids,
                )
            )

        raw_total = sum(f.contribution for f in computed)
        total_score = max(0, min(100, int(raw_total + 0.5)))

        evidence_weight = sum(f.contribution for f in computed)
        if evidence_weight > 0:
            confidence = (
                sum(f.contribution * f.confidence for f in computed) / evidence_weight
            )
        else:
            confidence = 0.0

        return RiskBreakdown(
            factors=tuple(sorted(computed, key=lambda f: f.factor_type.value)),
            total_score=total_score,
            level=self._level_for(total_score),
            confidence=max(0.0, min(1.0, confidence)),
            engine_version=self._config.engine_version,
        )

    def _level_for(self, score: int) -> RiskLevel:
        t = self._config.level_thresholds
        if score <= t.low_max:
            return RiskLevel.LOW
        if score <= t.medium_max:
            return RiskLevel.MEDIUM
        if score <= t.high_max:
            return RiskLevel.HIGH
        return RiskLevel.CRITICAL
