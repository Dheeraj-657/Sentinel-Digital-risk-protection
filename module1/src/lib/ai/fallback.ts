/**
 * Deterministic template explanation, used when Groq is not configured, unavailable,
 * rate-limited, or returns output that fails grounding checks.
 */
import type { AiAssessment } from "@/lib/engine/types";
import { CATEGORY_META, ENTITY_META, RISK_LEVEL_META } from "@/lib/engine/constants";
import type { ExplanationInput } from "./prompt";

/** Deterministic caveat when a low score rests on missing primary intelligence (null otherwise). */
export function primaryGapCaveat(x: ExplanationInput): string | null {
  if (!(x.primaryGaps ?? []).length || (x.riskLevel !== "VERY_LOW" && x.riskLevel !== "LOW")) return null;
  const kind = ENTITY_META[x.entity.type].label.toLowerCase();
  return `The primary source for this ${kind} (${x.primaryGaps!.join(", ")}) returned no data: the low score reflects missing evidence, not a clean result.`;
}

export function fallbackAssessment(x: ExplanationInput, reason: string): AiAssessment {
  const risky = x.signals.filter((s) => s.impact > 0);
  const mitig = x.signals.filter((s) => s.impact < 0);
  const level = RISK_LEVEL_META[x.riskLevel].label;
  const kind = ENTITY_META[x.entity.type].label.toLowerCase();
  const topCats = [...x.categories].filter((c) => c.points > 0).sort((a, b) => b.points - a.points).slice(0, 2);

  const primaryGap = (x.primaryGaps ?? []).length > 0 && (x.riskLevel === "VERY_LOW" || x.riskLevel === "LOW");
  let summary: string;
  if (!risky.length && primaryGap) {
    summary = `No risk indicators were found for this ${kind} (${x.entity.displayName}) in the data that was available, but its primary source (${x.primaryGaps!.join(", ")}) returned nothing. It is rated ${level} at ${x.riskScore}/100 with ${x.confidenceScore}% confidence; treat this as unverified, not safe.`;
  } else if (!risky.length) {
    summary = `This ${kind} (${x.entity.displayName}) shows no risk indicators${mitig.length ? ` and has ${mitig.length} mitigating signal${mitig.length > 1 ? "s" : ""}, including "${mitig[0].title}"` : ""}. It is rated ${level} at ${x.riskScore}/100 with ${x.confidenceScore}% confidence.`;
  } else {
    summary = `This ${kind} (${x.entity.displayName}) is rated ${level} at ${x.riskScore}/100 with ${x.confidenceScore}% confidence. The rating is driven mainly by ${topCats.map((c) => CATEGORY_META[c.category].label.toLowerCase()).join(" and ")}, with ${risky.length} risk signal${risky.length > 1 ? "s" : ""}; the strongest is "${risky[0].title}".${x.adjustments.length ? ` ${x.adjustments[0].reason}.` : ""}`;
  }

  const keyFindings = [...risky.slice(0, 4), ...mitig.slice(0, 1)].map((s) => ({
    text: `${s.title}: ${s.evidence}.`,
    signalIds: [s.id],
  }));
  const actionNotes = x.actions.slice(0, 5).map((a) => ({ actionId: a.id, note: a.rationale }));
  const caveats: string[] = [];
  const gapCaveat = primaryGapCaveat(x);
  if (gapCaveat) caveats.push(gapCaveat);
  if (x.providerGaps.length) caveats.push(`Some sources returned no data: ${x.providerGaps.join(", ")}.`);
  if (!x.brandName) caveats.push("No protected brand was supplied, so impersonation checks were limited.");

  return {
    summary,
    keyFindings,
    actionNotes,
    caveats,
    model: null,
    source: "FALLBACK",
    notes: [reason],
  };
}
