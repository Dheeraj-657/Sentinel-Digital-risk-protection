"""Risk engine unit tests: deterministic weighting, clamping, level boundaries,
classification priority (SYNTHETIC TEST_ONLY inputs).

The master contract under test: contribution = score x weight, factors without
evidence are omitted (never zero-filled), thresholds are configuration-owned.
"""
from __future__ import annotations

import pytest

from app.domain.enums import EvidenceBasis, FactorType, RiskLevel, ThreatClassification
from app.risk.calculator import ComputedFactor, FactorInput, RiskCalculator
from app.risk.config import (
    ClassificationThresholds,
    DEFAULT_RISK_ENGINE_CONFIG,
    RiskEngineConfig,
    RiskLevelThresholds,
)
from app.risk.classifier import ThreatClassifier

E1, E2 = "synthetic-evidence-1", "synthetic-evidence-2"


def single_factor_config(weight: float) -> RiskEngineConfig:
    """Config where one factor carries the entire weight — makes totals exact."""
    return RiskEngineConfig(
        factor_weights={
            factor: (weight if factor is FactorType.REPUTATION_SIGNALS else 0.0)
            for factor in FactorType
        }
    )


class TestRiskCalculator:
    def test_contribution_is_score_times_weight(self):
        calc = RiskCalculator(DEFAULT_RISK_ENGINE_CONFIG)
        breakdown = calc.compute([
            FactorInput(FactorType.TEXT_SIMILARITY, score=80, confidence=0.9,
                        evidence_ids=(E1,))
        ])
        assert len(breakdown.factors) == 1
        factor = breakdown.factors[0]
        assert factor.score == 80
        assert factor.weight == pytest.approx(0.15)
        assert factor.contribution == pytest.approx(12.0)
        assert breakdown.total_score == 12

    def test_factor_without_evidence_is_omitted_not_zero_scored(self):
        calc = RiskCalculator(DEFAULT_RISK_ENGINE_CONFIG)
        breakdown = calc.compute([
            FactorInput(FactorType.TEXT_SIMILARITY, score=90, confidence=1.0,
                        evidence_ids=())
        ])
        assert breakdown.factors == ()
        assert breakdown.total_score == 0

    def test_scores_clamped_to_valid_range(self):
        calc = RiskCalculator(DEFAULT_RISK_ENGINE_CONFIG)
        breakdown = calc.compute([
            FactorInput(FactorType.TEXT_SIMILARITY, score=150, confidence=0.5,
                        evidence_ids=(E1,)),
            FactorInput(FactorType.DOMAIN_SIGNALS, score=-20, confidence=0.5,
                        evidence_ids=(E2,)),
        ])
        assert all(0 <= f.score <= 100 for f in breakdown.factors)

    def test_level_boundaries_are_config_driven(self):
        calc = RiskCalculator(single_factor_config(1.0))
        expectations = {
            0: RiskLevel.LOW,
            25: RiskLevel.LOW,
            26: RiskLevel.MEDIUM,
            50: RiskLevel.MEDIUM,
            51: RiskLevel.HIGH,
            75: RiskLevel.HIGH,
            76: RiskLevel.CRITICAL,
            100: RiskLevel.CRITICAL,
        }
        for score, expected in expectations.items():
            breakdown = calc.compute([
                FactorInput(FactorType.REPUTATION_SIGNALS, score=score,
                            confidence=1.0, evidence_ids=(E1,))
            ])
            assert breakdown.level is expected, f"score {score}"

    def test_total_rounds_half_up_on_fractions(self):
        config = RiskEngineConfig(factor_weights={
            FactorType.TEXT_SIMILARITY: 0.5,
            FactorType.DOMAIN_SIGNALS: 0.5,
            **{f: 0.0 for f in FactorType
               if f not in (FactorType.TEXT_SIMILARITY, FactorType.DOMAIN_SIGNALS)},
        })
        calc = RiskCalculator(config)
        breakdown = calc.compute([
            FactorInput(FactorType.TEXT_SIMILARITY, score=51, confidence=0.5,
                        evidence_ids=(E1,)),
            FactorInput(FactorType.DOMAIN_SIGNALS, score=50, confidence=0.5,
                        evidence_ids=(E2,)),
        ])
        # 25.5 + 25.0 = 50.5 → 51 (half-up), never 50 (banker's rounding).
        assert breakdown.total_score == 51

    def test_confidence_is_contribution_weighted_average(self):
        calc = RiskCalculator(single_factor_config(1.0))
        breakdown = calc.compute([
            FactorInput(FactorType.REPUTATION_SIGNALS, score=60, confidence=0.2,
                        evidence_ids=(E1,)),
        ])
        assert breakdown.confidence == pytest.approx(0.2)

    def test_confidence_within_unit_interval(self):
        calc = RiskCalculator(DEFAULT_RISK_ENGINE_CONFIG)
        breakdown = calc.compute([
            FactorInput(FactorType.TEXT_SIMILARITY, score=80, confidence=0.9,
                        evidence_ids=(E1,)),
            FactorInput(FactorType.VISUAL_SIMILARITY, score=70, confidence=0.4,
                        evidence_ids=(E2,)),
        ])
        assert 0.0 <= breakdown.confidence <= 1.0

    def test_engine_version_flows_through_breakdown(self):
        calc = RiskCalculator(DEFAULT_RISK_ENGINE_CONFIG)
        breakdown = calc.compute([])
        assert breakdown.engine_version == DEFAULT_RISK_ENGINE_CONFIG.engine_version

    def test_deterministic_recomputation(self):
        calc = RiskCalculator(DEFAULT_RISK_ENGINE_CONFIG)
        inputs = [
            FactorInput(FactorType.TEXT_SIMILARITY, score=80, confidence=0.9,
                        evidence_ids=(E1,)),
            FactorInput(FactorType.VISUAL_SIMILARITY, score=70, confidence=0.4,
                        evidence_ids=(E2,)),
        ]
        assert calc.compute(inputs) == calc.compute(inputs)

    def test_factors_sorted_by_type_for_stable_output(self):
        calc = RiskCalculator(DEFAULT_RISK_ENGINE_CONFIG)
        breakdown = calc.compute([
            FactorInput(FactorType.VISUAL_SIMILARITY, score=70, confidence=0.4,
                        evidence_ids=(E1,)),
            FactorInput(FactorType.TEXT_SIMILARITY, score=80, confidence=0.9,
                        evidence_ids=(E2,)),
        ])
        assert [f.factor_type.value for f in breakdown.factors] == sorted(
            f.factor_type.value for f in breakdown.factors
        )


class TestConfigValidation:
    def test_default_config_is_valid(self):
        DEFAULT_RISK_ENGINE_CONFIG.validate()

    def test_weights_must_sum_to_one(self):
        config = RiskEngineConfig(factor_weights={
            factor: 0.5 for factor in FactorType
        })
        with pytest.raises(ValueError, match="sum to 1.0"):
            config.validate()

    def test_weights_must_cover_every_factor(self):
        weights = {factor: 1.0 / len(list(FactorType)) for factor in list(FactorType)[:-1]}
        with pytest.raises(ValueError, match="missing entries"):
            RiskEngineConfig(factor_weights=weights).validate()

    def test_level_thresholds_must_be_ascending(self):
        with pytest.raises(ValueError, match="ascending|satisfy"):
            RiskEngineConfig(level_thresholds=RiskLevelThresholds(
                low_max=50, medium_max=25, high_max=75
            )).validate()

    def test_calculator_rejects_invalid_config(self):
        with pytest.raises(ValueError):
            RiskCalculator(RiskEngineConfig(factor_weights={
                factor: 0.5 for factor in FactorType
            }))


class TestThreatClassifier:
    def computed(self, factor_type: FactorType, score: int) -> ComputedFactor:
        return ComputedFactor(
            factor_type=factor_type,
            score=score,
            weight=0.1,
            contribution=score * 0.1,
            confidence=0.8,
            basis=EvidenceBasis.OBSERVED,
            evidence_ids=(E1,),
        )

    def classifier(self, **overrides) -> ThreatClassifier:
        thresholds = ClassificationThresholds(**overrides) if overrides \
            else ClassificationThresholds()
        return ThreatClassifier(thresholds)

    def test_strong_domain_and_behavior_is_phishing(self):
        factors = [
            self.computed(FactorType.DOMAIN_SIGNALS, 80),
            self.computed(FactorType.BEHAVIORAL_SIGNALS, 80),
        ]
        assert self.classifier().classify(factors) is ThreatClassification.PHISHING

    def test_phishing_wins_priority_over_impersonation(self):
        factors = [
            self.computed(FactorType.DOMAIN_SIGNALS, 80),
            self.computed(FactorType.BEHAVIORAL_SIGNALS, 80),
            self.computed(FactorType.IDENTITY_SIMILARITY, 90),
            self.computed(FactorType.VISUAL_SIMILARITY, 90),
            self.computed(FactorType.TEXT_SIMILARITY, 90),
        ]
        assert self.classifier().classify(factors) is ThreatClassification.PHISHING

    def test_identity_visual_text_all_strong_is_impersonation(self):
        factors = [
            self.computed(FactorType.IDENTITY_SIMILARITY, 90),
            self.computed(FactorType.VISUAL_SIMILARITY, 85),
            self.computed(FactorType.TEXT_SIMILARITY, 75),
        ]
        assert self.classifier().classify(factors) is ThreatClassification.BRAND_IMPERSONATION

    def test_impersonation_requires_all_three_similarity_factors(self):
        factors = [
            self.computed(FactorType.IDENTITY_SIMILARITY, 90),
            self.computed(FactorType.VISUAL_SIMILARITY, 85),
        ]
        assert self.classifier().classify(factors) is ThreatClassification.UNKNOWN

    def test_domain_alone_strong_is_suspicious_domain(self):
        factors = [self.computed(FactorType.DOMAIN_SIGNALS, 75)]
        assert self.classifier().classify(factors) is ThreatClassification.SUSPICIOUS_DOMAIN

    def test_no_strong_signals_is_unknown(self):
        factors = [self.computed(FactorType.TEXT_SIMILARITY, 40)]
        assert self.classifier().classify(factors) is ThreatClassification.UNKNOWN

    def test_classification_is_deterministic(self):
        factors = [
            self.computed(FactorType.DOMAIN_SIGNALS, 80),
            self.computed(FactorType.BEHAVIORAL_SIGNALS, 80),
        ]
        classifier = self.classifier()
        assert classifier.classify(factors) == classifier.classify(factors)
