import type { RiskCategory, RiskLevel, Severity, EntityType } from "./types";

/**
 * Category caps. They sum to 100, so the final risk score is simply the
 * sum of each category's capped points — every point is traceable.
 */
export const CATEGORY_META: Record<RiskCategory, { label: string; cap: number; description: string }> = {
  identity: {
    label: "Identity Risk",
    cap: 15,
    description: "Whether the entity's stated identity (name, owner, developer, registrant) is consistent and legitimate.",
  },
  impersonation: {
    label: "Impersonation Risk",
    cap: 20,
    description: "Direct indicators that the entity is posing as the protected brand.",
  },
  behavioral: {
    label: "Behavioral Risk",
    cap: 10,
    description: "Account/site behaviour typical of scams: solicitation, giveaways, audience anomalies.",
  },
  domain: {
    label: "Domain / Website Risk",
    cap: 15,
    description: "Domain age, registration, hosting and URL-structure characteristics.",
  },
  reputation: {
    label: "Reputation & Threat Intel",
    cap: 15,
    description: "Matches against threat feeds, blocklists and reputation sources.",
  },
  brandSimilarity: {
    label: "Brand Similarity Risk",
    cap: 15,
    description: "Lexical and visual similarity to the protected brand (typosquats, homoglyphs, copied logos).",
  },
  technical: {
    label: "Technical Risk",
    cap: 10,
    description: "TLS, redirects, credential forms, dangerous app permissions and similar technical traits.",
  },
};

export const CATEGORY_ORDER: RiskCategory[] = [
  "impersonation",
  "brandSimilarity",
  "identity",
  "domain",
  "reputation",
  "behavioral",
  "technical",
];

/** Reference points per severity; individual rules use these values. */
export const SEVERITY_POINTS: Record<Severity, number> = {
  INFO: 0,
  LOW: 4,
  MEDIUM: 8,
  HIGH: 13,
  CRITICAL: 20,
};

export const RISK_LEVEL_META: Record<RiskLevel, { label: string; min: number; max: number }> = {
  VERY_LOW: { label: "Very Low Risk", min: 0, max: 20 },
  LOW: { label: "Low Risk", min: 21, max: 40 },
  MEDIUM: { label: "Medium Risk", min: 41, max: 60 },
  HIGH: { label: "High Risk", min: 61, max: 80 },
  CRITICAL: { label: "Critical Risk", min: 81, max: 100 },
};

export function riskLevelFor(score: number): RiskLevel {
  if (score >= 81) return "CRITICAL";
  if (score >= 61) return "HIGH";
  if (score >= 41) return "MEDIUM";
  if (score >= 21) return "LOW";
  return "VERY_LOW";
}

export const ENTITY_META: Record<EntityType, { label: string; placeholder: string; help: string }> = {
  PROFILE: {
    label: "Social Profile",
    placeholder: "https://instagram.com/acmebank_support_help  or  x:acmebank_official",
    help: "Profile URL, or platform:handle (instagram, x, facebook, tiktok, linkedin, youtube, telegram).",
  },
  WEBSITE: {
    label: "Website",
    placeholder: "https://acmebank-secure-verify.com/login",
    help: "Full URL of the page to analyse, including path.",
  },
  DOMAIN: {
    label: "Domain",
    placeholder: "acmeb4nk-support.com",
    help: "Bare domain or hostname, no path needed.",
  },
  APP: {
    label: "Mobile App",
    placeholder: "com.acmebank.secure.update  or a Play Store URL",
    help: "Android package name, Play Store URL, or App Store URL.",
  },
};

/** Default timeouts & limits */
export const PROVIDER_DEFAULT_TIMEOUT_MS = 6000;
export const PROVIDER_CACHE_TTL_MS = 10 * 60 * 1000;
