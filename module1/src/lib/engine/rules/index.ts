/**
 * Signal normalization: provider facts → explainable, weighted signals.
 * Rules are pure functions; their order does not affect the score.
 */
import type { BrandReference, NormalizedEntity, ProviderResult, ScoreAdjustment, Signal } from "../types";
import { buildContext, type Rule, type RuleOutput, type SignalDraft } from "./context";
import { brandSimilarityRules, impersonationRules, multiIndicatorRule } from "./brand-impersonation";
import { behavioralRules, identityRules } from "./identity-behavior";
import { domainRules, reputationRules, technicalRules } from "./domain-rep-tech";

export const ALL_RULES: Rule[] = [
  ...brandSimilarityRules,
  ...impersonationRules,
  ...identityRules,
  ...behavioralRules,
  ...domainRules,
  ...reputationRules,
  ...technicalRules,
];

const SEVERITY_RANK = { CRITICAL: 5, HIGH: 4, MEDIUM: 3, LOW: 2, INFO: 1 } as const;

export function evaluateSignals(
  entity: NormalizedEntity,
  brand: BrandReference | null,
  results: ProviderResult[],
): { signals: Signal[]; adjustments: ScoreAdjustment[]; isOfficial: boolean; claimsBrand: boolean } {
  const ctx = buildContext(entity, brand, results);
  const out: RuleOutput = { signals: [], adjustments: [] };
  for (const rule of ALL_RULES) {
    try {
      rule(ctx, out);
    } catch (err) {
      // A buggy rule must never break a scan; it simply contributes nothing.
      console.error("[risk-engine] rule failed", err);
    }
  }
  const derived = multiIndicatorRule(ctx, out.signals);
  if (derived) out.signals.push(derived);

  // De-duplicate identical rule+evidence pairs, then order: risk signals by impact, mitigations last.
  const seen = new Set<string>();
  const unique: SignalDraft[] = out.signals.filter((s) => {
    const k = `${s.ruleId}|${s.evidence}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  unique.sort((a, b) => {
    if ((a.impact > 0) !== (b.impact > 0)) return a.impact > 0 ? -1 : 1;
    if (b.impact !== a.impact) return Math.abs(b.impact) - Math.abs(a.impact);
    return SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
  });
  const signals: Signal[] = unique.map((s, i) => ({ ...s, id: `S${i + 1}` }));
  return { signals, adjustments: out.adjustments, isOfficial: ctx.isOfficial, claimsBrand: ctx.claimsBrand };
}
