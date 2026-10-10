/**
 * Deterministic risk scoring.
 *
 *   category points = clamp(Σ risk impacts − Σ mitigations, 0, category cap)
 *   base score      = Σ category points            (caps sum to 100)
 *   final score     = max(base, explicit floors)    (floors are listed in the report)
 *
 * The LLM never touches this.
 */
import { CATEGORY_META, CATEGORY_ORDER, riskLevelFor } from "./constants";
import type { CategoryScore, ScoreAdjustment, ScoreResult, Signal } from "./types";

export function scoreSignals(signals: Signal[], adjustments: ScoreAdjustment[]): ScoreResult {
  const categories: CategoryScore[] = CATEGORY_ORDER.map((category) => {
    const { cap, label } = CATEGORY_META[category];
    const inCat = signals.filter((s) => s.category === category);
    const rawPoints = inCat.filter((s) => s.impact > 0).reduce((n, s) => n + s.impact, 0);
    const mitigationPoints = inCat.filter((s) => s.impact < 0).reduce((n, s) => n - s.impact, 0);
    const net = rawPoints - mitigationPoints;
    const points = Math.max(0, Math.min(cap, net));
    return {
      category,
      label,
      cap,
      rawPoints,
      mitigationPoints,
      points,
      percent: Math.round((points / cap) * 100),
      signalCount: inCat.length,
      capped: net > cap,
    };
  });

  const baseScore = categories.reduce((n, c) => n + c.points, 0);
  let riskScore = baseScore;
  const applied: ScoreAdjustment[] = [];
  for (const a of adjustments) {
    if (a.kind === "FLOOR" && a.value > riskScore) {
      riskScore = a.value;
      applied.push(a);
    } else if (a.kind === "CEILING" && a.value < riskScore) {
      riskScore = a.value;
      applied.push(a);
    }
  }
  riskScore = Math.max(0, Math.min(100, Math.round(riskScore)));
  return { riskScore, riskLevel: riskLevelFor(riskScore), baseScore, categories, adjustments: applied };
}
