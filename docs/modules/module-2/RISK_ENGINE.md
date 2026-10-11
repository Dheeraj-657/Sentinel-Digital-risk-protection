# Module 2 — Risk Engine

The risk engine is deterministic, versioned, and fully explainable. Source of
truth for every number below: `app/risk/config.py` (`ENGINE_VERSION 1.0.0`,
`DEFAULT_RISK_ENGINE_CONFIG`, validated at import).

## Math

```
contribution_i = score_i × weight_i          # score ∈ [0,100] int, weight ∈ [0,1]
total          = clamp(Σ contributions, 0, 100), rounded HALF-UP to integer
level          = threshold band of total
confidence     = Σ(contribution_i × confidence_i) / Σ(contribution_i)   (∈ [0,1]; 0.0 when no factors)
```

- Intermediate floats are **never rounded**; only the final aggregate is
  (`int(raw_total + 0.5)`).
- `score` is clamped into [0,100] per factor; `confidence` into [0,1].
- Factors **without evidence are omitted, never zero-filled** — an absent
  factor contributes 0 to the total honestly, and consumers can see which
  weights did not participate.
- Determinism: frozen dataclasses end-to-end; same inputs → identical
  breakdown, proven by test (`test_risk_engine.py::...determinism`).

## Factor weights (default)

| FactorType | Weight | Typical basis | Produced from |
|---|---|---|---|
| IDENTITY_SIMILARITY | 0.20 | DERIVED | identity model over entity handles/names vs brand name/aliases |
| TEXT_SIMILARITY | 0.15 | DERIVED | text model over evidence text vs brand name + text signals |
| VISUAL_SIMILARITY | 0.20 | DERIVED | visual model over evidence image_hash vs BrandDNA visual_assets content_hash |
| DOMAIN_SIGNALS | 0.15 | INFERRED | rule score: domain similarity > 0.4 to official domains (+35+sim·45), registration ≤ 60 days (+25), whois privacy (+10); verified domains return None |
| BEHAVIORAL_SIGNALS | 0.10 | OBSERVED | recent_account_creation +40, high_post_frequency +25, brand_mimicry_in_bio +35 |
| REPUTATION_SIGNALS | 0.10 | OBSERVED | blocklisted → 85, abuse_reports → min(100, 20·reports) (max-wins) |
| RELATIONSHIP_SIGNALS | 0.10 | INFERRED | linked_to_known_threat → 70, shared_identifiers ≥ 2 → 60 (max-wins) |

Sum of weights = 1.0 (validated; a config that doesn't sum to 1.0 raises at
construction — `RiskEngineConfig.validate()`).

Confidence per factor: similarity factors use the raw model score; DOMAIN
`0.55 + 0.15·(#contributions)`; BEHAVIORAL `0.6 + 0.1·(#events)`; REPUTATION
0.7; RELATIONSHIP 0.65 — all clamped to ≤ 1.0.

## Risk levels

| Band | Level |
|---|---|
| 0 ≤ score ≤ 25 | LOW |
| 26–50 | MEDIUM |
| 51–75 | HIGH |
| 76–100 | CRITICAL |

(`RiskLevelThresholds`: `score ≤ low_max → LOW; ≤ medium_max → MEDIUM; ≤
high_max → HIGH; else CRITICAL`. Thresholds validated strictly ascending.)

Boundary example (verified by test): 25 → LOW, 26 → MEDIUM, 50 → MEDIUM,
51 → HIGH, 75 → HIGH, 76 → CRITICAL. Half-up: 25.5+25.0 = 50.5 → 51.

## Classification (first match wins)

| Priority | Classification | Rule (factor scores ≥ threshold) |
|---|---|---|
| 1 | PHISHING | DOMAIN_SIGNALS ≥ 65 **and** BEHAVIORAL_SIGNALS ≥ 65 — credential-harvesting pattern is the most actionable |
| 2 | BRAND_IMPERSONATION | IDENTITY_SIMILARITY ≥ 70 **and** VISUAL_SIMILARITY ≥ 70 **and** TEXT_SIMILARITY ≥ 70 — coordinated identity abuse requires all three |
| 3 | SUSPICIOUS_DOMAIN | DOMAIN_SIGNALS ≥ 70 |
| 4 | UNKNOWN | none matched — the risk score still stands |

Separate from scoring by design: `ThreatClassifier` reads only factor scores;
it can never move the number. `RiskService.evaluate()` = calculator +
classifier in one deterministic step.

## Evidence gating

| Knob | Default | Effect |
|---|---|---|
| `minimum_evidence_per_factor` | 1 | candidates citing fewer evidence ids are dropped by the calculator |
| `minimum_total_evidence` | 1 | `EvidenceService.collect` raises `INSUFFICIENT_EVIDENCE` (422) below this — no evidence, no analysis: an unexplained score is worse than no score |

Every factor carries `evidence_ids`; `AnalysisEvidenceReference` rows record
which evidence ids (and `source_id`s) the run used and which factor types
cited them — full audit trail from score back to Module 3 evidence.

## Versioning policy

`engine_version` is persisted on every Threat and AnalysisResult. Changing a
weight, threshold, extractor rule, or the rounding/banding semantics
**requires shipping a new `ENGINE_VERSION`** so historical snapshots remain
interpretable. Model changes are tracked separately via the composite
`model_version` string on the same rows.

## Configuration example (override in code — env override of nested weights is TBD)

```python
from app.risk.config import RiskEngineConfig, RiskLevelThresholds, ClassificationThresholds
from app.domain.enums import FactorType

config = RiskEngineConfig(
    factor_weights={FactorType.DOMAIN_SIGNALS: 1.0, **{f: 0.0 for f in FactorType if f != FactorType.DOMAIN_SIGNALS}},
    level_thresholds=RiskLevelThresholds(low_max=20, medium_max=45, high_max=70),
    classification_thresholds=ClassificationThresholds(impersonation_factor_score=80),
)
config.validate()
RiskService(config)
```
