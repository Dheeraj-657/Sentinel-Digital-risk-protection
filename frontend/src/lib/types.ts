// Wire types mirroring the actual API schemas:
//   Module 1 — Sentinel DRP route handlers (src/app/api/**/route.ts)
//   Module 2 — backend/app/schemas/{threat,analysis}.py
//   Module 3 — module3/module3/schemas.py

// ---------- Module 1 (Sentinel DRP) ----------

export interface M1Brand {
  /** Sentinel cuid — Module 2 derives its brand UUID from this via uuid5. */
  id: string;
  name: string;
  officialDomains: string[];
  officialHandles: string[];
  appDevelopers: string[];
  packagePrefixes: string[];
  keywords: string[];
  isDemo: boolean;
  scanCount: number;
}

export interface M1Health {
  status: string;
  database: string;
  intelMode: string;
  ai: { provider: string; configured: boolean; model: string };
  providers: { id: string; name: string; kind: string; origin: string }[];
}

export type M1RiskLevel = "VERY_LOW" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type M1EntityType = "PROFILE" | "WEBSITE" | "DOMAIN" | "APP";
export type M1Severity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type M1RiskCategory =
  | "identity"
  | "impersonation"
  | "behavioral"
  | "domain"
  | "reputation"
  | "brandSimilarity"
  | "technical";
export type M1DataOrigin = "COMPUTED" | "LIVE" | "DEMO";
export type M1ActionPriority = "IMMEDIATE" | "HIGH" | "MEDIUM" | "LOW";

export interface M1Signal {
  id: string;
  ruleId: string;
  category: M1RiskCategory;
  severity: M1Severity;
  title: string;
  description: string;
  /** Concrete observed evidence string (Module 1 keeps one string per signal). */
  evidence: string;
  impact: number;
  provider: string;
  origin: M1DataOrigin;
  reliability: number;
}

export interface M1CategoryScore {
  category: M1RiskCategory;
  label: string;
  cap: number;
  rawPoints: number;
  mitigationPoints: number;
  points: number;
  percent: number;
  signalCount: number;
  capped: boolean;
}

export interface M1RecommendedAction {
  id: string;
  action: string;
  priority: M1ActionPriority;
  rationale: string;
  basedOn: string[];
}

export interface M1BrandInput {
  name: string;
  officialDomains?: string[];
  officialHandles?: string[];
  appDevelopers?: string[];
  packagePrefixes?: string[];
  keywords?: string[];
}

export interface M1ScanRequest {
  entityType: M1EntityType;
  input: string;
  claimedDeveloper?: string;
  brandId?: string | null;
}

/** POST /api/scans returns the full report plus the stored id. */
export type M1ScanCreated = M1ScanReport & { id: string };

export interface M1ScanReport {
  id?: string;
  riskScore: number;
  riskLevel: M1RiskLevel;
  confidenceScore: number;
  baseScore: number;
  riskBreakdown: Record<M1RiskCategory, number>;
  categories: M1CategoryScore[];
  scoreAdjustments: { kind: "FLOOR" | "CEILING"; value: number; reason: string; ruleId: string }[];
  confidenceFactors: { key: string; label: string; points: number; max: number; detail: string }[];
  signals: M1Signal[];
  aiAssessment: {
    summary: string;
    keyFindings: { text: string; signalIds: string[] }[];
    actionNotes: { actionId: string; note: string }[];
    caveats: string[];
    model: string | null;
    source: "GROQ" | "FALLBACK";
    notes: string[];
  };
  recommendedActions: M1RecommendedAction[];
  providerRuns: {
    providerId: string;
    providerName: string;
    kind: string;
    status: string;
    origin: M1DataOrigin;
    latencyMs: number;
    message?: string;
  }[];
  intelMode: "demo" | "live";
  durationMs: number;
  timestamp: string;
  entity: {
    type: M1EntityType;
    input: string;
    target: string;
    displayName: string;
    claimedDeveloper?: string;
  };
  /** BrandReference — id present when the scan ran against a stored brand. */
  brand: (M1BrandInput & { id?: string }) | null;
}

export interface M1ScanSummary {
  id: string;
  entityType: M1EntityType;
  target: string;
  displayName: string;
  brandName: string | null;
  riskScore: number;
  riskLevel: M1RiskLevel;
  confidenceScore: number;
  aiSource: string;
  signalCount: number;
  createdAt: string;
}

export interface M1ScanListResponse {
  items: M1ScanSummary[];
  nextCursor: string | null;
  total: number;
}

export interface M1ScanHistoryPoint {
  id: string;
  riskScore: number;
  riskLevel: M1RiskLevel;
  confidenceScore: number;
  createdAt: string;
  aiSource: string;
}

export interface M1ScanDetail {
  report: M1ScanReport;
  history: M1ScanHistoryPoint[];
}

export interface M1Stats {
  total: number;
  levels: Record<M1RiskLevel, number>;
  byType: { type: M1EntityType; count: number; avgRisk: number }[];
  avgRisk: number;
  avgConfidence: number;
  recentHigh: M1ScanSummary[];
  recent: M1ScanSummary[];
  topSignals: { ruleId: string; title: string; count: number }[];
}

// ---------- Module 2 (Risk Engine) ----------

export type JobStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type ThreatStatus = "OPEN" | "CONFIRMED" | "DISMISSED";
export type ThreatClassification =
  | "BRAND_IMPERSONATION"
  | "PHISHING"
  | "SUSPICIOUS_DOMAIN"
  | "UNKNOWN";
export type FactorType =
  | "IDENTITY_SIMILARITY"
  | "TEXT_SIMILARITY"
  | "VISUAL_SIMILARITY"
  | "DOMAIN_SIGNALS"
  | "BEHAVIORAL_SIGNALS"
  | "REPUTATION_SIGNALS"
  | "RELATIONSHIP_SIGNALS";
export type EvidenceBasis = "OBSERVED" | "DERIVED" | "INFERRED" | "PREDICTED";

export interface AnalysisResultSummary {
  result_id: string;
  threat_id: string;
  risk_score: number;
  risk_level: RiskLevel;
  classification: ThreatClassification;
  confidence: number;
  evidence_count: number;
  analysis_timestamp: string;
}

export interface AnalysisJob {
  job_id: string;
  status: JobStatus;
  brand_id: string;
  entity_id: string;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  result?: AnalysisResultSummary | null;
}

export interface RiskFactor {
  factor_id: string;
  factor_type: FactorType;
  /** 0–100 */
  score: number;
  /** 0–1, engine-configured weight */
  weight: number;
  /** points contributed to the total risk score */
  contribution: number;
  /** 0–1 */
  confidence: number;
  basis: EvidenceBasis;
  evidence_ids: string[];
}

export interface EvidenceReference {
  evidence_id: string;
  source_id: string;
  factor_types: FactorType[];
}

export interface ThreatSummary {
  threat_id: string;
  entity_id: string;
  brand_id: string;
  risk_score: number;
  risk_level: RiskLevel;
  classification: ThreatClassification;
  status: ThreatStatus;
  analysis_timestamp: string;
}

export interface ThreatDetail extends ThreatSummary {
  tenant_id: string;
  confidence: number;
  model_version: string;
  risk_engine_version: string;
  created_at: string;
  updated_at: string;
  risk_factors: RiskFactor[];
  evidence_references: EvidenceReference[];
}

export interface ThreatListResponse {
  items: ThreatSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface M2JobListItem {
  job_id: string;
  status: JobStatus;
  brand_id: string;
  entity_id: string;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  error_code?: string | null;
  /** Present for completed jobs only. */
  threat_id?: string | null;
}

export interface M2JobListResponse {
  items: M2JobListItem[];
  total: number;
  limit: number;
  offset: number;
}

// ---------- Module 3 (Entity & Evidence) ----------

export type M3EntityType =
  | "SOCIAL_PROFILE"
  | "WEBSITE"
  | "DOMAIN"
  | "MOBILE_APP"
  | "MESSAGING_ACCOUNT"
  | "OTHER";

export type M3EvidenceType =
  | "IDENTITY_MATCH"
  | "TEXT_CONTENT"
  | "VISUAL_ASSET"
  | "DOMAIN_INTEL"
  | "BEHAVIORAL_EVENT"
  | "REPUTATION_INTEL"
  | "RELATIONSHIP_LINK";

export interface M3Entity {
  entity_id: string;
  tenant_id: string;
  entity_type: M3EntityType;
  display_name: string | null;
  identifiers: Record<string, string>;
  attributes: Record<string, unknown>;
}

export interface M3EntityListItem extends M3Entity {
  created_at: string;
  updated_at: string;
}

export interface M3EntityListResponse {
  items: M3EntityListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface M3Evidence {
  evidence_id: string;
  source_id: string;
  entity_id: string;
  evidence_type: M3EvidenceType;
  collected_at: string;
  text: string | null;
  image_hash: string | null;
  url: string | null;
  metadata: Record<string, unknown>;
}

export interface M3Source {
  source_id: string;
  name: string;
  kind: string;
  created_at: string;
}

export interface M3SourceListResponse {
  items: M3Source[];
  total: number;
  limit: number;
  offset: number;
}

// ---------- Module 2 (Discovery jobs + related threats) ----------

export type DiscoveryJobStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "PARTIAL" | "FAILED";

export interface DiscoveryQueryItem {
  provider: string;
  term: string;
  /** Brand DNA signal the term was derived from. */
  basis: string;
}

export type DiscoveryProviderStatus =
  | "COMPLETED"
  | "EMPTY"
  | "UNCONFIGURED"
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "FAILED";

export interface DiscoveryProviderOutcome {
  provider: string;
  status: DiscoveryProviderStatus;
  candidate_count: number;
  warning: string | null;
  error: string | null;
  latency_ms: number | null;
}

export interface DiscoveryCandidate {
  providers: string[];
  kind: string;
  domain: string | null;
  url: string | null;
  title: string | null;
  snippet: string | null;
  /** Brand DNA signal this candidate was observed through. */
  query_basis: string;
  observed_at: string;
  discovery_fingerprint: string | null;
  entity_id: string | null;
  evidence_id: string | null;
  analysis_job_id: string | null;
  analysis_status: string | null;
}

export interface DiscoveryJob {
  job_id: string;
  status: DiscoveryJobStatus;
  brand_id: string;
  queries: DiscoveryQueryItem[];
  provider_outcomes: DiscoveryProviderOutcome[];
  candidates: DiscoveryCandidate[];
  source_ids: Record<string, string>;
  duplicate_count: number;
  warning_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  error_code: string | null;
  error_message: string | null;
}

export interface DiscoveryJobListItem {
  job_id: string;
  status: DiscoveryJobStatus;
  brand_id: string;
  duplicate_count: number;
  candidate_count: number;
  created_at: string;
  completed_at: string | null;
  error_code: string | null;
}

export interface DiscoveryJobListResponse {
  items: DiscoveryJobListItem[];
  total: number;
  limit: number;
  offset: number;
}

export type DiscoveryQueryParams = {
  status?: DiscoveryJobStatus;
  limit?: number;
  offset?: number;
};

// ---------- Module 2 (Evidence-backed related threats) ----------

export interface SharedAttribute {
  /** Identifier key present on both entities (e.g. "domain", "handle"). */
  key: string;
  /** The exact shared value — no normalization or similarity. */
  value: string;
}

export type RelatedThreatRelationType = "SHARED_DOMAIN" | "SHARED_IDENTIFIER";

export interface RelatedThreatItem {
  threat_id: string;
  entity_id: string;
  entity_display_name: string | null;
  relation_type: RelatedThreatRelationType;
  /** How the relation was established — EXACT_ATTRIBUTE_MATCH. */
  basis: string;
  shared_attribute: SharedAttribute;
  evidence_ids: string[];
  target_evidence_ids: string[];
}

export interface RelatedThreatsResponse {
  threat_id: string;
  items: RelatedThreatItem[];
  total: number;
  /** Non-fatal notes — never silent skips. */
  warnings: string[];
}
