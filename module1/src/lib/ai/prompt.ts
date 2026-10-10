import type { CategoryScore, ConfidenceFactor, NormalizedEntity, RecommendedAction, RiskLevel, ScoreAdjustment, Signal } from "@/lib/engine/types";
import { RISK_LEVEL_META } from "@/lib/engine/constants";

export interface ExplanationInput {
  entity: NormalizedEntity;
  brandName: string | null;
  riskScore: number;
  riskLevel: RiskLevel;
  confidenceScore: number;
  categories: CategoryScore[];
  adjustments: ScoreAdjustment[];
  confidenceFactors: ConfidenceFactor[];
  signals: Signal[];
  actions: RecommendedAction[];
  providerGaps: string[];
  /** Primary source(s) for this entity type that returned nothing — low scores are then NOT clean results. */
  primaryGaps?: string[];
}

export const SYSTEM_PROMPT = `You are a senior threat-intelligence analyst writing the "AI Assessment" section of a Digital Risk Protection report.

STRICT RULES — violations cause your output to be discarded:
1. The risk score, risk level, confidence score and recommended actions are FINAL. They were computed deterministically. Never change, re-estimate or argue with them.
2. Use ONLY the facts in the provided JSON. Do not add facts, numbers, dates, names, URLs, victims, attacker motives or capabilities that are not in the evidence.
3. Every key finding must cite the signal ids (e.g. "S1") that support it. Do not cite ids that do not exist.
4. Do not write any number unless it appears verbatim in the input JSON.
5. Signals with negative impact are mitigating evidence — mention them honestly.
6. If evidence is thin or some sources returned no data, say so in caveats. If primaryIntelGaps is non-empty, \
state that a low score reflects missing evidence, never that the entity is safe or legitimate.
7. Be concise, specific and professional. No markdown.

Return ONLY a JSON object with exactly this shape:
{
  "summary": "2–4 sentences: what this entity appears to be and why it received its rating.",
  "keyFindings": [ { "text": "one sentence interpreting combined evidence", "signalIds": ["S1","S3"] } ],
  "actionNotes": [ { "actionId": "A1", "note": "one sentence on why/when to do this, grounded in the evidence" } ],
  "caveats": [ "short limitation of this assessment" ]
}
Give 2–5 keyFindings (fewer if there are few signals), one actionNote per action (max 5), 0–3 caveats.`;

export function buildUserPrompt(x: ExplanationInput): string {
  const payload = {
    entity: {
      type: x.entity.type,
      identifier: x.entity.displayName,
      target: x.entity.target,
      platform: x.entity.platform,
      url: x.entity.url,
    },
    protectedBrand: x.brandName,
    finalRating: {
      riskScore: x.riskScore,
      riskLevel: RISK_LEVEL_META[x.riskLevel].label,
      confidenceScore: x.confidenceScore,
      appliedAdjustments: x.adjustments.map((a) => a.reason),
    },
    categoryBreakdown: x.categories
      .filter((c) => c.signalCount > 0)
      .map((c) => ({ category: c.label, points: c.points, cap: c.cap })),
    signals: x.signals.map((s) => ({
      id: s.id,
      category: s.category,
      severity: s.severity,
      impact: s.impact,
      title: s.title,
      evidence: s.evidence,
      dataOrigin: s.origin,
    })),
    recommendedActions: x.actions.map((a) => ({ id: a.id, action: a.action, priority: a.priority })),
    dataGaps: x.providerGaps,
    primaryIntelGaps: x.primaryGaps ?? [],
    confidenceFactors: x.confidenceFactors.map((f) => `${f.label}: ${f.detail}`),
  };
  return `Write the AI assessment for this analysis. Input JSON:\n${JSON.stringify(payload, null, 2)}`;
}
