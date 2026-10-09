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
