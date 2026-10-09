import type { FactorType, RiskLevel, ThreatClassification } from "./types";

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
