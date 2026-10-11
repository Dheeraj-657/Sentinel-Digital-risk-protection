/**
 * Core types for the AI Threat Intelligence & Risk Engine.
 *
 * Pipeline:
 *   EntityInput → Intelligence Providers → Signal Normalization →
 *   Deterministic Risk Scoring → Confidence → Groq Explanation → Final Report
 */

export const ENTITY_TYPES = ["PROFILE", "WEBSITE", "DOMAIN", "APP"] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const RISK_LEVELS = ["VERY_LOW", "LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const SEVERITIES = ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const CATEGORIES = [
  "identity",
  "impersonation",
  "behavioral",
  "domain",
  "reputation",
  "brandSimilarity",
  "technical",
] as const;
export type RiskCategory = (typeof CATEGORIES)[number];

/** Where a piece of evidence came from. */
export type DataOrigin =
  | "COMPUTED" // deterministic local analysis of the input itself (always real)
  | "LIVE" // fetched from a real external source at scan time
  | "DEMO"; // curated demo threat-intel dataset (clearly labelled in the UI)

export type SocialPlatform =
  | "instagram"
  | "x"
  | "facebook"
  | "tiktok"
  | "linkedin"
  | "youtube"
  | "telegram"
  | "other";

/** Reference data for the brand/person being protected. */
export interface BrandReference {
  id?: string;
  name: string;
  officialDomains: string[];
  officialHandles: string[];
  appDevelopers: string[];
  packagePrefixes: string[];
  keywords: string[];
}

export interface NormalizedEntity {
  type: EntityType;
  input: string;
  /** Stable identifier used for history comparison. */
  target: string;
  displayName: string;
  /** Websites/domains */
  url?: string;
  host?: string;
  registrableDomain?: string;
  tld?: string;
  subdomain?: string;
  scheme?: string;
  path?: string;
  /** Profiles */
  platform?: SocialPlatform;
  handle?: string;
  profileUrl?: string;
  /** Apps */
  packageName?: string;
  appName?: string;
  storeUrl?: string;
  /** Optional extra context the analyst typed (e.g. claimed developer). */
  claimedDeveloper?: string;
}

/* ------------------------------------------------------------------ */
/* Provider layer                                                       */
/* ------------------------------------------------------------------ */

export type ProviderKind =
  | "url-analysis"
  | "brand-similarity"
  | "domain-intel"
  | "reputation"
  | "web-content"
  | "social-intel"
  | "app-intel";

export type ProviderStatus = "OK" | "NO_DATA" | "ERROR" | "TIMEOUT" | "SKIPPED";

export interface ProviderContext {
  entity: NormalizedEntity;
  brand: BrandReference | null;
  signal: AbortSignal;
}

/** Raw facts returned by a provider. Rules turn facts into signals. */
export interface ProviderResult<T = unknown> {
  providerId: string;
  providerName: string;
  kind: ProviderKind;
  status: ProviderStatus;
  origin: DataOrigin;
  /** 0–1 how much we trust this provider's data. */
  reliability: number;
  latencyMs: number;
  data: T | null;
  message?: string;
}

export interface IntelProvider<T = unknown> {
  id: string;
  name: string;
  kind: ProviderKind;
  origin: DataOrigin;
  reliability: number;
  /** Max time this provider may take before it is abandoned. */
  timeoutMs: number;
  supports(entity: NormalizedEntity): boolean;
  collect(ctx: ProviderContext): Promise<{ status: ProviderStatus; data: T | null; message?: string }>;
}

/* ------------------------------------------------------------------ */
/* Signals & scoring                                                    */
/* ------------------------------------------------------------------ */

export interface Signal {
  /** Short stable id used by the AI layer to cite evidence, e.g. "S3". */
  id: string;
  ruleId: string;
  category: RiskCategory;
  severity: Severity;
  title: string;
  description: string;
  /** Human-readable, concrete evidence string (the actual observed data). */
  evidence: string;
  /** Points added to (or, if negative, removed from) the category. */
  impact: number;
  provider: string;
  origin: DataOrigin;
  reliability: number;
}

export interface CategoryScore {
  category: RiskCategory;
  label: string;
  cap: number;
  /** Sum of positive signal points. */
  rawPoints: number;
  /** Sum of mitigating points (as a positive number). */
  mitigationPoints: number;
  /** clamp(raw - mitigation, 0, cap) — this is what is added to the score. */
  points: number;
  /** points / cap * 100 — the category's own 0–100 risk. */
  percent: number;
  signalCount: number;
  capped: boolean;
}

export interface ScoreAdjustment {
  kind: "FLOOR" | "CEILING";
  value: number;
  reason: string;
  ruleId: string;
}

export interface ScoreResult {
  riskScore: number;
  riskLevel: RiskLevel;
  baseScore: number;
  categories: CategoryScore[];
  adjustments: ScoreAdjustment[];
}

export interface ConfidenceFactor {
  key: "coverage" | "independence" | "reliability" | "reference" | "conflict";
  label: string;
  points: number;
  max: number;
  detail: string;
}

export interface ConfidenceResult {
  confidenceScore: number;
  factors: ConfidenceFactor[];
}

export type ActionPriority = "IMMEDIATE" | "HIGH" | "MEDIUM" | "LOW";

export interface RecommendedAction {
  id: string;
  action: string;
  priority: ActionPriority;
  rationale: string;
  /** Signal ids that justify this action. */
  basedOn: string[];
}

/* ------------------------------------------------------------------ */
/* AI layer                                                             */
/* ------------------------------------------------------------------ */

export interface AiFinding {
  text: string;
  signalIds: string[];
}

export interface AiAssessment {
  summary: string;
  keyFindings: AiFinding[];
  actionNotes: { actionId: string; note: string }[];
  caveats: string[];
  model: string | null;
  source: "GROQ" | "FALLBACK";
  /** Why the fallback was used, or grounding notes. */
  notes: string[];
}

/* ------------------------------------------------------------------ */
/* Final report                                                         */
/* ------------------------------------------------------------------ */

export interface ProviderRunSummary {
  providerId: string;
  providerName: string;
  kind: ProviderKind;
  status: ProviderStatus;
  origin: DataOrigin;
  latencyMs: number;
  message?: string;
}

export interface PipelineStage {
  stage: "validate" | "collect" | "normalize" | "score" | "confidence" | "actions" | "explain";
  label: string;
  ms: number;
  detail: string;
}

export interface AnalysisReport {
  id?: string;
  pipeline: PipelineStage[];
  entity: NormalizedEntity;
  brand: BrandReference | null;
  riskScore: number;
  riskLevel: RiskLevel;
  confidenceScore: number;
  riskBreakdown: Record<RiskCategory, number>;
  categories: CategoryScore[];
  scoreAdjustments: ScoreAdjustment[];
  baseScore: number;
  confidenceFactors: ConfidenceFactor[];
  signals: Signal[];
  aiAssessment: AiAssessment;
  recommendedActions: RecommendedAction[];
  providerRuns: ProviderRunSummary[];
  intelMode: IntelMode;
  durationMs: number;
  timestamp: string;
}

export type IntelMode = "demo" | "live";
