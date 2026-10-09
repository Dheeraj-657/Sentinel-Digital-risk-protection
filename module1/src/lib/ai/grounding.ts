/**
 * Grounding guard: validates the LLM output against the evidence it was given.
 *  - schema must match
 *  - findings must cite existing signal ids (uncited / unknown → dropped)
 *  - any number not present in the input evidence → that sentence is dropped
 *  - a summary that names a different risk level than the computed one is rejected
 */
import { z } from "zod";
import type { AiAssessment, RiskLevel } from "@/lib/engine/types";
import { RISK_LEVEL_META } from "@/lib/engine/constants";
import type { ExplanationInput } from "./prompt";

export const llmOutputSchema = z.object({
  summary: z.string().min(10).max(1200),
  keyFindings: z
    .array(z.object({ text: z.string().min(5).max(500), signalIds: z.array(z.string()).default([]) }))
    .max(8)
    .default([]),
  actionNotes: z
    .array(z.object({ actionId: z.string(), note: z.string().min(3).max(400) }))
    .max(10)
    .default([]),
  caveats: z.array(z.string().max(300)).max(5).default([]),
});

function allowedNumbers(x: ExplanationInput): Set<string> {
  const corpus = JSON.stringify({
    s: x.signals.map((s) => [s.id, s.title, s.evidence, s.impact]),
    c: x.categories.map((c) => [c.points, c.cap, c.percent]),
    a: x.actions.map((a) => a.id),
    adj: x.adjustments.map((a) => a.reason),
    f: x.confidenceFactors.map((f) => f.detail),
    t: x.entity.target,
    u: x.entity.url,
  });
  const nums = new Set(corpus.match(/\d+(?:\.\d+)?/g) ?? []);
  [x.riskScore, x.confidenceScore, 100, 0].forEach((n) => nums.add(String(n)));
  return nums;
}

function numbersIn(text: string): string[] {
  // Ignore signal/action ids like S3 / A2 — they're validated separately.
  return text.replace(/\b[SA]\d+\b/g, "").match(/\d+(?:\.\d+)?/g) ?? [];
}

const LEVEL_PHRASES: Record<RiskLevel, RegExp> = {
  VERY_LOW: /\bvery[- ]low[- ]risk\b/i,
  LOW: /(?<!very[- ])\blow[- ]risk\b/i,
  MEDIUM: /\bmedium[- ]risk\b/i,
  HIGH: /\bhigh[- ]risk\b/i,
  CRITICAL: /\bcritical[- ]risk\b/i,
};

export function groundAssessment(
  raw: unknown,
  x: ExplanationInput,
  model: string,
): { ok: true; value: AiAssessment } | { ok: false; reason: string } {
  const parsed = llmOutputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "AI output did not match the required schema" };
  const out = parsed.data;
  const notes: string[] = [];
  const allowed = allowedNumbers(x);
  const signalIds = new Set(x.signals.map((s) => s.id));
  const actionIds = new Set(x.actions.map((a) => a.id));
  const invented = (t: string) => numbersIn(t).filter((n) => !allowed.has(n));

  // Summary: reject on invented numbers or a contradicting risk level.
  const badNums = invented(out.summary);
  if (badNums.length) return { ok: false, reason: `AI summary contained numbers not in the evidence (${badNums.join(", ")})` };
  const statedOtherLevel = (Object.keys(LEVEL_PHRASES) as RiskLevel[]).some(
    (lvl) => lvl !== x.riskLevel && LEVEL_PHRASES[lvl].test(out.summary) && !(x.riskLevel === "CRITICAL" && lvl === "HIGH"),
  );
  if (statedOtherLevel) return { ok: false, reason: `AI summary contradicted the computed level (${RISK_LEVEL_META[x.riskLevel].label})` };

  const keyFindings = out.keyFindings
    .map((f) => ({ text: f.text.trim(), signalIds: [...new Set(f.signalIds.map((s) => s.trim().toUpperCase()))].filter((id) => signalIds.has(id)) }))
    .filter((f) => {
      if (!f.signalIds.length) {
        notes.push("Dropped an AI finding that cited no valid evidence");
        return false;
      }
      if (invented(f.text).length) {
        notes.push("Dropped an AI finding containing numbers not present in the evidence");
        return false;
      }
      return true;
    })
    .slice(0, 5);

  if (x.signals.some((s) => s.impact > 0) && keyFindings.length === 0) {
    return { ok: false, reason: "AI produced no findings grounded in valid signal ids" };
  }

  const actionNotes = out.actionNotes
    .map((a) => ({ actionId: a.actionId.trim().toUpperCase(), note: a.note.trim() }))
    .filter((a) => actionIds.has(a.actionId) && !invented(a.note).length);
  const caveats = out.caveats.map((c) => c.trim()).filter((c) => c && !invented(c).length).slice(0, 3);

  return { ok: true, value: { summary: out.summary.trim(), keyFindings, actionNotes, caveats, model, source: "GROQ", notes } };
}
