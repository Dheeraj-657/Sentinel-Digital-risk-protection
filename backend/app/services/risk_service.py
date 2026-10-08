"""Risk evaluation facade: calculation + classification in one step."""
from __future__ import annotations

from dataclasses import dataclass

from app.domain.enums import ThreatClassification
from app.risk.calculator import ComputedFactor, RiskBreakdown, RiskCalculator
from app.risk.classifier import ThreatClassifier
from app.risk.config import RiskEngineConfig


@dataclass(frozen=True)
class RiskVerdict:
    breakdown: RiskBreakdown
    classification: ThreatClassification


class RiskService:
    def __init__(self, config: RiskEngineConfig | None = None) -> None:
        self._config = config or RiskEngineConfig()
        self._calculator = RiskCalculator(self._config)
        self._classifier = ThreatClassifier(self._config.classification_thresholds)

    @property
    def engine_version(self) -> str:
        return self._config.engine_version

    def evaluate(self, factor_inputs: list) -> RiskVerdict:
        breakdown = self._calculator.compute(factor_inputs)
        classification = self._classifier.classify(list(breakdown.factors))
        return RiskVerdict(breakdown=breakdown, classification=classification)


def computed_factor_signature(factors: list[ComputedFactor]) -> tuple:
    """Stable signature of a factor set — used to detect real score changes."""
    return tuple(
        (f.factor_type.value, f.score, round(f.weight, 6), round(f.contribution, 6))
        for f in sorted(factors, key=lambda x: x.factor_type.value)
    )
