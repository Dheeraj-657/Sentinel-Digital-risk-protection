/**
 * Deterministic recommended actions, driven by risk level, entity type and specific signals.
 * The AI layer may explain/prioritise these, but cannot add or remove them.
 */
import type { EntityType, NormalizedEntity, ProviderKind, ProviderResult, RecommendedAction, RiskLevel, Signal } from "./types";

/** The intelligence source that actually observes each entity type. */
const PRIMARY_INTEL: Record<EntityType, ProviderKind> = {
  PROFILE: "social-intel",
  APP: "app-intel",
  WEBSITE: "web-content",
  DOMAIN: "domain-intel",
};

/**
 * Names of primary sources that produced no usable data for this entity.
 * When this is non-empty a low score means "not enough evidence", never "safe".
 */
export function primaryIntelGaps(entity: NormalizedEntity, results: Pick<ProviderResult, "kind" | "status" | "providerName">[]): string[] {
  const kind = PRIMARY_INTEL[entity.type];
  const runs = results.filter((r) => r.kind === kind);
  if (runs.length === 0) return [`${kind} (no provider configured)`];
  return runs.some((r) => r.status === "OK") ? [] : runs.map((r) => r.providerName);
}

const PRIORITY_ORDER = { IMMEDIATE: 0, HIGH: 1, MEDIUM: 2, LOW: 3 } as const;

export function recommendActions(
  entity: NormalizedEntity,
  level: RiskLevel,
  signals: Signal[],
  opts: { isOfficial: boolean; confidence: number; primaryGaps?: string[] },
): RecommendedAction[] {
  const actions: RecommendedAction[] = [];
  const has = (...ids: string[]) => signals.filter((s) => ids.includes(s.ruleId)).map((s) => s.id);
  const risky = signals.filter((s) => s.impact > 0);
  const top = risky.slice(0, 3).map((s) => s.id);
  const add = (a: Omit<RecommendedAction, "id">) => {
    if (!actions.some((x) => x.action === a.action)) actions.push({ ...a, basedOn: [...new Set(a.basedOn)], id: `A${actions.length + 1}` });
  };

  const venue =
    entity.type === "PROFILE"
      ? `${entity.platform === "other" ? "the platform" : entity.platform![0].toUpperCase() + entity.platform!.slice(1)}`
      : entity.type === "APP"
        ? "the app store / distribution site"
        : "the registrar and hosting provider";
  const blockable = entity.type === "DOMAIN" || entity.type === "WEBSITE";

  if (opts.isOfficial && level === "VERY_LOW") {
    add({ action: "No action needed: verified official asset", priority: "LOW", rationale: "Entity matches the brand's registered official assets.", basedOn: has("OFFICIAL_ASSET") });
    add({ action: "Keep in official-asset inventory", priority: "LOW", rationale: "Use as a reference for future look-alike comparisons.", basedOn: has("OFFICIAL_ASSET") });
    return actions;
  }

  switch (level) {
    case "CRITICAL":
      add({ action: "Submit takedown request", priority: "IMMEDIATE", rationale: `Request removal via ${venue}; evidence meets the bar for an abuse/impersonation report.`, basedOn: top });
      if (blockable) add({ action: "Block domain / URL (DNS, proxy & email filters)", priority: "IMMEDIATE", rationale: "Prevent employees and customers on managed networks from reaching it.", basedOn: [...has("THREAT_FEED_MALICIOUS", "BRANDED_CREDENTIAL_FORM"), ...top].slice(0, 3) });
      add({ action: "Escalate to security team", priority: "IMMEDIATE", rationale: "Active threat against the brand or its customers requires incident handling.", basedOn: top });
      add({ action: "Preserve evidence (screenshots, WHOIS, headers)", priority: "HIGH", rationale: "Evidence is needed for takedown and may disappear once the entity is reported.", basedOn: top });
      break;
    case "HIGH":
      add({ action: entity.type === "PROFILE" ? "Report impersonation to platform" : entity.type === "APP" ? "File impersonation complaint with app store" : "Report abuse to registrar & host", priority: "HIGH", rationale: `Strong impersonation evidence justifies a report to ${venue}.`, basedOn: top });
      if (blockable) add({ action: "Add to domain blocklist", priority: "HIGH", rationale: "Pre-emptively block while the report is processed.", basedOn: top });
      add({ action: "Escalate to security team", priority: "HIGH", rationale: "Analyst review recommended before customer-facing communication.", basedOn: top });
      add({ action: "Preserve evidence (screenshots, WHOIS, headers)", priority: "MEDIUM", rationale: "Keep a record in case the entity changes or is deleted.", basedOn: top });
      break;
    case "MEDIUM":
      add({ action: "Investigate further", priority: "HIGH", rationale: "Several risk indicators are present but not conclusive.", basedOn: top });
      add({ action: "Verify ownership", priority: "MEDIUM", rationale: "Confirm whether a partner, reseller or business unit operates this entity.", basedOn: top });
      add({ action: "Add to watchlist and re-scan in 48 hours", priority: "MEDIUM", rationale: "Scam infrastructure often escalates shortly after setup.", basedOn: top });
      break;
    case "LOW":
    case "VERY_LOW":
      if (opts.primaryGaps?.length) {
        // Missing intelligence is not evidence of safety.
        add({
          action: "Collect missing intelligence before clearing",
          priority: "MEDIUM",
          rationale: `The primary source for this ${entity.type.toLowerCase()} (${opts.primaryGaps.join(", ")}) returned no data, so the low score reflects missing evidence, not a clean result.`,
          basedOn: top,
        });
        add({ action: "Re-scan once more intelligence is available", priority: "LOW", rationale: "Re-run the engine after the primary source can observe the entity.", basedOn: top });
      } else if (level === "LOW") {
        add({ action: "Monitor", priority: "MEDIUM", rationale: "Minor indicators only; track for changes.", basedOn: top });
        add({ action: "Re-scan in 7 days", priority: "LOW", rationale: "Detect escalation such as new content or threat-feed listings.", basedOn: top });
      } else {
        add({ action: "Monitor", priority: "LOW", rationale: "No meaningful risk indicators in the intelligence that was available.", basedOn: [] });
      }
      break;
  }

  // Signal-specific additions
  const cred = has("BRANDED_CREDENTIAL_FORM", "CREDENTIALS_SENT_ELSEWHERE");
  if (cred.length && (level === "HIGH" || level === "CRITICAL")) {
    add({ action: "Alert fraud team to watch for compromised customer accounts", priority: "HIGH", rationale: "A live credential-harvesting form may already have captured logins.", basedOn: cred });
    add({ action: "Warn customers via official channels", priority: "MEDIUM", rationale: "Customer awareness reduces victims while takedown is pending.", basedOn: cred });
  }
  const links = signals.find((s) => s.ruleId === "LINKS_TO_LOOKALIKE");
  if (links) {
    add({ action: "Scan the linked look-alike domain", priority: "HIGH", rationale: "The linked site is likely the actual payload and should be analysed and blocked.", basedOn: [links.id] });
  }
  const perms = has("DANGEROUS_PERMISSIONS", "SIDELOADED_APP");
  if (perms.length && (level === "HIGH" || level === "CRITICAL")) {
    add({ action: "Submit sample to mobile-malware analysis", priority: "HIGH", rationale: "Permissions match banking-trojan capabilities; confirm behaviour in a sandbox.", basedOn: perms });
  }
  if (opts.confidence < 45 && level !== "VERY_LOW") {
    add({ action: "Gather more intelligence before acting", priority: "MEDIUM", rationale: `Confidence is only ${opts.confidence}/100 — several sources had no data.`, basedOn: [] });
  }

  return actions.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]).map((a, i) => ({ ...a, id: `A${i + 1}` }));
}
