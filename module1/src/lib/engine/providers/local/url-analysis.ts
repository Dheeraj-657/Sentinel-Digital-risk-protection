import { domainToUnicode } from "node:url";
import type { IntelProvider } from "../../types";
import type { UrlAnalysisData } from "../contracts";
import { isIpAddress } from "../../entity";
import {
  FREE_HOSTING_SUFFIXES,
  RISKY_TLDS,
  SUSPICIOUS_HOST_KEYWORDS,
  SUSPICIOUS_PATH_KEYWORDS,
  URL_SHORTENERS,
} from "../../lexicon";

/**
 * Lexical URL / domain structure analysis. Pure computation on the input — real data in every mode.
 */
export const urlAnalysisProvider: IntelProvider<UrlAnalysisData> = {
  id: "local.url-analysis",
  name: "URL & Domain Structure Analyzer",
  kind: "url-analysis",
  origin: "COMPUTED",
  reliability: 0.95,
  timeoutMs: 1000,
  supports: (e) => e.type === "WEBSITE" || e.type === "DOMAIN",
  async collect({ entity }) {
    const host = entity.host!;
    const labels = host.split(".");
    const subdomain = entity.subdomain ?? "";
    const hostTokens = host.toLowerCase().split(/[.\-_]/);
    const hostKeywords = SUSPICIOUS_HOST_KEYWORDS.filter((k) => hostTokens.includes(k) || (k.length >= 5 && host.includes(k)));
    const path = (entity.path ?? "").toLowerCase();
    const pathKeywords = SUSPICIOUS_PATH_KEYWORDS.filter((k) => path.includes(k));
    const isPunycode = labels.some((l) => l.startsWith("xn--"));
    const unicodeHost = isPunycode ? domainToUnicode(host) || null : null;
    const freeHost = FREE_HOSTING_SUFFIXES.find((s) => host === s || host.endsWith(`.${s}`)) ?? null;
    let port: string | null = null;
    let hasAt = false;
    if (entity.url) {
      const u = new URL(entity.url);
      port = u.port && !["80", "443"].includes(u.port) ? u.port : null;
      hasAt = entity.input.replace(/^[a-z]+:\/\//i, "").split("/")[0].includes("@");
    }
    const data: UrlAnalysisData = {
      host,
      registrableDomain: entity.registrableDomain ?? host,
      tld: entity.tld ?? "",
      subdomain,
      subdomainDepth: subdomain ? subdomain.split(".").filter((l) => l !== "www").length : 0,
      hyphenCount: (entity.registrableDomain ?? host).split("-").length - 1,
      digitCount: ((entity.registrableDomain ?? host).match(/\d/g) ?? []).length,
      hostLength: host.length,
      isIpHost: isIpAddress(host),
      isPunycode,
      unicodeHost,
      usesHttps: entity.type === "WEBSITE" && entity.scheme ? entity.scheme === "https" : null,
      hasAtSymbol: hasAt,
      nonStandardPort: port,
      suspiciousHostKeywords: [...new Set(hostKeywords)].filter((k, _i, all) => !all.some((o) => o !== k && o.startsWith(k))),
      suspiciousPathKeywords: [...new Set(pathKeywords)],
      riskyTld: RISKY_TLDS.has((entity.tld ?? "").split(".").pop() ?? ""),
      freeHostingProvider: freeHost,
      urlShortener: URL_SHORTENERS.has(entity.registrableDomain ?? host),
    };
    return { status: "OK", data };
  },
};
