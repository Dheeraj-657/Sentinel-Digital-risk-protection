/**
 * Entity Input → Intelligence Providers → Signal Normalization → Deterministic Risk Scoring
 *   → Confidence Calculation → Recommended Actions → AI Explanation → Final Report
 *
 * The explanation step is injected (Groq in the app, template in tests) and receives the
 * already-final score; nothing it returns can change the numbers.
 */
import type { AiAssessment, AnalysisReport, BrandReference, EntityType, IntelMode, PipelineStage, RiskCategory } from "./types";
import { CATEGORIES } from "./types";
import { normalizeEntity } from "./entity";
import { collectIntelligence, getIntelMode } from "./providers/registry";
import { evaluateSignals } from "./rules";
import { scoreSignals } from "./scoring";
import { computeConfidence } from "./confidence";
import { primaryIntelGaps, recommendActions } from "./actions";
import type { ExplanationInput } from "@/lib/ai/prompt";

export type Explainer = (input: ExplanationInput) => Promise<AiAssessment>;

export interface AnalyzeOptions {
  entityType: EntityType;
  input: string;
  claimedDeveloper?: string;
  brand: BrandReference | null;
  explain: Explainer;
  mode?: IntelMode;
}

export async function analyzeEntity(opts: AnalyzeOptions): Promise<AnalysisReport> {
  const started = Date.now();
  const pipeline: PipelineStage[] = [];
  let t = Date.now();
  const lap = (stage: PipelineStage["stage"], label: string, detail: string) => {
    const now = Date.now();
    pipeline.push({ stage, label, ms: now - t, detail });
    t = now;
  };
  const mode = opts.mode ?? getIntelMode();

  // 1. Validate & normalize input (throws EntityValidationError)
  const entity = normalizeEntity(opts.entityType, opts.input, opts.claimedDeveloper);
  lap("validate", "Input validated & normalized", `${entity.type} → ${entity.target}`);

  // 2. Intelligence providers (parallel, timeout-guarded, failures isolated)
  const results = await collectIntelligence(entity, opts.brand, mode);
  const ok = results.filter((r) => r.status === "OK").length;
  lap("collect", "Intelligence gathered", `${ok}/${results.length} providers returned data (${mode} mode)`);

  // 3. Signal normalization
  const { signals, adjustments, isOfficial } = evaluateSignals(entity, opts.brand, results);
  lap("normalize", "Signals normalized", `${signals.filter((s) => s.impact > 0).length} risk, ${signals.filter((s) => s.impact < 0).length} mitigating signals`);

  // 4. Deterministic scoring
  const score = scoreSignals(signals, adjustments);
  lap("score", "Deterministic risk score", `${score.baseScore} base${score.adjustments.length ? ` → ${score.riskScore} after floor` : ""} = ${score.riskLevel}`);

  // 5. Confidence
  const conf = computeConfidence(results, signals, opts.brand);
  lap("confidence", "Confidence calculated", `${conf.confidenceScore}/100`);

  // 6. Recommended actions (deterministic)
  const primaryGaps = isOfficial ? [] : primaryIntelGaps(entity, results);
  const actions = recommendActions(entity, score.riskLevel, signals, { isOfficial, confidence: conf.confidenceScore, primaryGaps });
  lap("actions", "Actions selected", `${actions.length} actions`);

  // 7. AI explanation (grounded; cannot alter the above)
  const providerGaps = results
    .filter((r) => r.status === "NO_DATA" || r.status === "ERROR" || r.status === "TIMEOUT")
    .map((r) => r.providerName);
  const aiAssessment = await opts.explain({
    entity,
    brandName: opts.brand?.name ?? null,
    riskScore: score.riskScore,
    riskLevel: score.riskLevel,
    confidenceScore: conf.confidenceScore,
    categories: score.categories,
    adjustments: score.adjustments,
    confidenceFactors: conf.factors,
    signals,
    actions,
    providerGaps,
    primaryGaps,
  });
  lap("explain", aiAssessment.source === "GROQ" ? "AI assessment (Groq)" : "Explanation (template fallback)", aiAssessment.model ?? aiAssessment.notes[0] ?? "");

  const riskBreakdown = Object.fromEntries(
    CATEGORIES.map((c) => [c, score.categories.find((x) => x.category === c)?.percent ?? 0]),
  ) as Record<RiskCategory, number>;

  return {
    entity,
    brand: opts.brand,
    riskScore: score.riskScore,
    riskLevel: score.riskLevel,
    confidenceScore: conf.confidenceScore,
    riskBreakdown,
    categories: score.categories,
    scoreAdjustments: score.adjustments,
    baseScore: score.baseScore,
    confidenceFactors: conf.factors,
    signals,
    aiAssessment,
    recommendedActions: actions,
    providerRuns: results.map((r) => ({
      providerId: r.providerId,
      providerName: r.providerName,
      kind: r.kind,
      status: r.status,
      origin: r.origin,
      latencyMs: r.latencyMs,
      message: r.message,
    })),
    pipeline,
    intelMode: mode,
    durationMs: Date.now() - started,
    timestamp: new Date().toISOString(),
  };
}
