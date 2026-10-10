"""Risk engine: configuration, calculation, classification.

Deterministic by design: identical (entity, brand DNA, evidence, model
versions, config) always produce identical output. Weights and thresholds
live ONLY here — no service may embed its own.
"""
from app.risk.config import (
    DEFAULT_RISK_ENGINE_CONFIG,
    ClassificationThresholds,
    RiskEngineConfig,
    RiskLevelThresholds,
)
from app.risk.calculator import ComputedFactor, FactorInput, RiskBreakdown, RiskCalculator
from app.risk.classifier import ThreatClassifier

__all__ = [
    "ClassificationThresholds",
    "ComputedFactor",
    "DEFAULT_RISK_ENGINE_CONFIG",
    "FactorInput",
    "RiskBreakdown",
    "RiskCalculator",
    "RiskEngineConfig",
    "RiskLevelThresholds",
    "ThreatClassifier",
]
