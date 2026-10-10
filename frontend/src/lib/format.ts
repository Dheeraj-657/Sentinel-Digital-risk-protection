import type {
  DiscoveryJobStatus,
  DiscoveryProviderStatus,
  FactorType,
  JobStatus,
  M1ActionPriority,
  M1DataOrigin,
  M1EntityType,
  M1RiskCategory,
  M1RiskLevel,
  M1Severity,
  RiskLevel,
  ThreatClassification,
} from "./types";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${dateFormatter.format(date)} UTC`;
}

export function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

export const RISK_LEVEL_LABEL: Record<RiskLevel, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  CRITICAL: "Critical",
};

/** Risk-level text color on the shared tokens (LOW→low … CRITICAL→critical). */
export const RISK_LEVEL_CLASS: Record<RiskLevel, string> = {
  LOW: "text-risk-low",
  MEDIUM: "text-risk-medium",
  HIGH: "text-risk-high",
  CRITICAL: "text-risk-critical",
};

export const RISK_LEVEL_BAR: Record<RiskLevel, string> = {
  LOW: "bg-risk-low",
  MEDIUM: "bg-risk-medium",
  HIGH: "bg-risk-high",
  CRITICAL: "bg-risk-critical",
};

export const FACTOR_LABEL: Record<FactorType, string> = {
  IDENTITY_SIMILARITY: "Identity similarity",
  TEXT_SIMILARITY: "Text similarity",
  VISUAL_SIMILARITY: "Visual similarity",
  DOMAIN_SIGNALS: "Domain signals",
  BEHAVIORAL_SIGNALS: "Behavioral signals",
  REPUTATION_SIGNALS: "Reputation signals",
  RELATIONSHIP_SIGNALS: "Relationship signals",
};

export const FACTOR_LABEL_LOWER: Record<FactorType, string> = {
  IDENTITY_SIMILARITY: "identity similarity",
  TEXT_SIMILARITY: "text similarity",
  VISUAL_SIMILARITY: "visual similarity",
  DOMAIN_SIGNALS: "domain signals",
  BEHAVIORAL_SIGNALS: "behavioral signals",
  REPUTATION_SIGNALS: "reputation signals",
  RELATIONSHIP_SIGNALS: "relationship signals",
};

export const CLASSIFICATION_LABEL: Record<ThreatClassification, string> = {
  BRAND_IMPERSONATION: "Brand impersonation",
  PHISHING: "Phishing",
  SUSPICIOUS_DOMAIN: "Suspicious domain",
  UNKNOWN: "Unclassified",
};

export const EVIDENCE_TYPE_LABEL: Record<string, string> = {
  IDENTITY_MATCH: "Identity match",
  TEXT_CONTENT: "Text content",
  VISUAL_ASSET: "Visual asset",
  DOMAIN_INTEL: "Domain intel",
  BEHAVIORAL_EVENT: "Behavioral event",
  REPUTATION_INTEL: "Reputation intel",
  RELATIONSHIP_LINK: "Relationship link",
};

export const ENTITY_TYPE_LABEL: Record<string, string> = {
  SOCIAL_PROFILE: "Social profile",
  WEBSITE: "Website",
  DOMAIN: "Domain",
  MOBILE_APP: "Mobile app",
  MESSAGING_ACCOUNT: "Messaging account",
  OTHER: "Other",
};

export function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/* ---------- Module 1 (Sentinel) variants — VERY_LOW level, own categories ---------- */

export const M1_RISK_LEVEL_LABEL: Record<M1RiskLevel, string> = {
  VERY_LOW: "Very low",
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  CRITICAL: "Critical",
};

/** Module 1 has a VERY_LOW tier the shared tokens don't — it reuses the low ramp. */
export const M1_RISK_LEVEL_CLASS: Record<M1RiskLevel, string> = {
  VERY_LOW: "text-risk-low",
  LOW: "text-risk-low",
  MEDIUM: "text-risk-medium",
  HIGH: "text-risk-high",
  CRITICAL: "text-risk-critical",
};

export const M1_RISK_LEVEL_BAR: Record<M1RiskLevel, string> = {
  VERY_LOW: "bg-risk-low",
  LOW: "bg-risk-low",
  MEDIUM: "bg-risk-medium",
  HIGH: "bg-risk-high",
  CRITICAL: "bg-risk-critical",
};

export const M1_ENTITY_TYPE_LABEL: Record<M1EntityType, string> = {
  PROFILE: "Profile",
  WEBSITE: "Website",
  DOMAIN: "Domain",
  APP: "Mobile app",
};

export const M1_SEVERITY_LABEL: Record<M1Severity, string> = {
  INFO: "Info",
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  CRITICAL: "Critical",
};

export const M1_CATEGORY_LABEL: Record<M1RiskCategory, string> = {
  identity: "Identity",
  impersonation: "Impersonation",
  behavioral: "Behavioral",
  domain: "Domain",
  reputation: "Reputation",
  brandSimilarity: "Brand similarity",
  technical: "Technical",
};

export const M1_PRIORITY_LABEL: Record<M1ActionPriority, string> = {
  IMMEDIATE: "Immediate",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
};

export const M1_ORIGIN_LABEL: Record<M1DataOrigin, string> = {
  COMPUTED: "Computed",
  LIVE: "Live",
  DEMO: "Demo dataset",
};

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  QUEUED: "Queued",
  RUNNING: "Running",
  COMPLETED: "Completed",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

/* ---------- Discovery jobs (Module 2) ---------- */

export const DISCOVERY_JOB_STATUS_LABEL: Record<DiscoveryJobStatus, string> = {
  QUEUED: "Queued",
  RUNNING: "Running",
  COMPLETED: "Completed",
  PARTIAL: "Partial",
  FAILED: "Failed",
};

export const DISCOVERY_JOB_STATUS_TONE: Record<DiscoveryJobStatus, BadgeTone> = {
  QUEUED: "neutral",
  RUNNING: "ai",
  COMPLETED: "low",
  PARTIAL: "medium",
  FAILED: "critical",
};

export const DISCOVERY_PROVIDER_STATUS_LABEL: Record<DiscoveryProviderStatus, string> = {
  COMPLETED: "Completed",
  EMPTY: "No results",
  UNCONFIGURED: "Not configured",
  TIMEOUT: "Timed out",
  RATE_LIMITED: "Rate limited",
  FAILED: "Failed",
};

type BadgeTone = "neutral" | "low" | "medium" | "high" | "critical" | "ai" | "evidence" | "action";

/** Provider outcome → badge tone. UNCONFIGURED is neutral (an honest
 * configuration note, not a failure); real failures use the risk ramp. */
export const DISCOVERY_PROVIDER_STATUS_TONE: Record<DiscoveryProviderStatus, BadgeTone> = {
  COMPLETED: "low",
  EMPTY: "neutral",
  UNCONFIGURED: "neutral",
  TIMEOUT: "medium",
  RATE_LIMITED: "medium",
  FAILED: "high",
};
