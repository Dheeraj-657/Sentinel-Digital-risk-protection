/** Shared presentation helpers (client-safe). */
import type { EntityType, RiskCategory, RiskLevel, Severity } from "./engine/types";

export const LEVEL_STYLE: Record<RiskLevel, { label: string; color: string; text: string; bg: string; border: string }> = {
  VERY_LOW: { label: "Very Low Risk", color: "var(--color-risk-verylow)", text: "text-risk-verylow", bg: "bg-risk-verylow/12", border: "border-risk-verylow/40" },
  LOW: { label: "Low Risk", color: "var(--color-risk-low)", text: "text-risk-low", bg: "bg-risk-low/12", border: "border-risk-low/40" },
  MEDIUM: { label: "Medium Risk", color: "var(--color-risk-medium)", text: "text-risk-medium", bg: "bg-risk-medium/12", border: "border-risk-medium/40" },
  HIGH: { label: "High Risk", color: "var(--color-risk-high)", text: "text-risk-high", bg: "bg-risk-high/12", border: "border-risk-high/40" },
  CRITICAL: { label: "Critical Risk", color: "var(--color-risk-critical)", text: "text-risk-critical", bg: "bg-risk-critical/12", border: "border-risk-critical/40" },
};

export const SEVERITY_STYLE: Record<Severity, { label: string; text: string; bg: string; dot: string }> = {
  CRITICAL: { label: "Critical", text: "text-risk-critical", bg: "bg-risk-critical/12", dot: "bg-risk-critical" },
  HIGH: { label: "High", text: "text-risk-high", bg: "bg-risk-high/12", dot: "bg-risk-high" },
  MEDIUM: { label: "Medium", text: "text-risk-medium", bg: "bg-risk-medium/12", dot: "bg-risk-medium" },
  LOW: { label: "Low", text: "text-risk-low", bg: "bg-risk-low/12", dot: "bg-risk-low" },
  INFO: { label: "Mitigating", text: "text-risk-verylow", bg: "bg-risk-verylow/12", dot: "bg-risk-verylow" },
};

/** Distinct, colour-blind-friendlier hues for category segments in the score ruler. */
export const CATEGORY_COLOR: Record<RiskCategory, string> = {
  impersonation: "#f0524f",
  brandSimilarity: "#f0883e",
  identity: "#e3b341",
  domain: "#c084fc",
  reputation: "#ef6f9d",
  behavioral: "#5eb8d6",
  technical: "#7c9cf5",
};

export const ENTITY_LABEL: Record<EntityType, string> = {
  PROFILE: "Social profile",
  WEBSITE: "Website",
  DOMAIN: "Domain",
  APP: "Mobile app",
};

export function timeAgo(iso: string): string {
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} day${d > 1 ? "s" : ""} ago`;
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}
