import type { Rule } from "./context";
import { sig } from "./context";
import { DANGEROUS_PERMISSIONS, LURE_TERMS } from "../lexicon";
import { splitHost } from "../entity";

/* ============================== DOMAIN / WEBSITE ============================== */

export const domainRules: Rule[] = [
  // Registration age
  (ctx, out) => {
    const d = ctx.domain;
    if (!d || d.data.ageDays === null || ctx.url?.data.freeHostingProvider) return;
    const age = d.data.ageDays;
    const when = d.data.createdAt ? new Date(d.data.createdAt).toISOString().slice(0, 10) : "unknown date";
    if (age < 30) {
      out.signals.push(
        sig(d, {
          ruleId: "DOMAIN_NEW",
          category: "domain",
          severity: "HIGH",
          impact: 13,
          title: "Domain was recently registered",
          description: "Most phishing domains are used within days of registration.",
          evidence: `${d.data.domain} registered ${age} days ago (${when}) via ${d.data.registrar ?? "unknown registrar"}`,
        }),
      );
    } else if (age < 180) {
      out.signals.push(
        sig(d, {
          ruleId: "DOMAIN_YOUNG",
          category: "domain",
          severity: "MEDIUM",
          impact: 7,
          title: "Domain is less than 6 months old",
          description: "Young domains have limited reputation history.",
          evidence: `${d.data.domain} registered ${age} days ago (${when})`,
        }),
      );
    } else if (age > 1825) {
      out.signals.push(
        sig(d, {
          ruleId: "DOMAIN_AGED",
          category: "domain",
          severity: "INFO",
          impact: -8,
          title: "Domain has been registered for over 5 years",
          description: "Long-lived domains are rarely throwaway phishing infrastructure.",
          evidence: `${d.data.domain} registered ${Math.floor(age / 365)} years ago (${when})`,
        }),
      );
    }
    if (d.data.popularityRank !== null && d.data.popularityRank <= 10000) {
      out.signals.push(
        sig(d, {
          ruleId: "DOMAIN_POPULAR",
          category: "domain",
          severity: "INFO",
          impact: -6,
          title: "Domain ranks among the most-visited sites",
          description: "Highly visited domains have well-established ownership.",
          evidence: `Popularity rank #${d.data.popularityRank.toLocaleString("en-US")}`,
        }),
      );
    }
  },
  // URL structure
  (ctx, out) => {
    const u = ctx.url;
    if (!u || ctx.isOfficial) return;
    const x = u.data;
    if (x.isIpHost) {
      out.signals.push(sig(u, { ruleId: "IP_HOST", category: "domain", severity: "HIGH", impact: 12, title: "URL uses a raw IP address instead of a domain", description: "Legitimate brands virtually never send users to bare IP addresses.", evidence: `Host: ${x.host}` }));
    }
    if (x.isPunycode) {
      out.signals.push(sig(u, { ruleId: "PUNYCODE_HOST", category: "domain", severity: "HIGH", impact: 10, title: "Internationalized (punycode) domain", description: "Punycode domains can render with foreign characters that look identical to Latin letters (IDN homograph attack).", evidence: `${x.host} renders as "${x.unicodeHost ?? x.host}"` }));
    }
    if (x.riskyTld) {
      out.signals.push(sig(u, { ruleId: "RISKY_TLD", category: "domain", severity: "MEDIUM", impact: 6, title: `Uses a high-abuse top-level domain (.${x.tld})`, description: "This TLD is cheap to register and disproportionately used for phishing and scams.", evidence: `TLD: .${x.tld}` }));
    }
    if (x.freeHostingProvider) {
      out.signals.push(sig(u, { ruleId: "FREE_HOSTING", category: "domain", severity: "MEDIUM", impact: 7, title: "Hosted on a free / self-service hosting platform", description: "Free hosting lets anyone publish a branded page in minutes with no identity checks.", evidence: `Hosted under ${x.freeHostingProvider}` }));
    }
    if (x.urlShortener) {
      out.signals.push(sig(u, { ruleId: "URL_SHORTENER", category: "domain", severity: "MEDIUM", impact: 6, title: "Link uses a URL shortener", description: "Shorteners hide the real destination from the user.", evidence: `Shortener: ${x.registrableDomain}` }));
    }
    if (x.suspiciousHostKeywords.length) {
      const branded = ctx.claimsBrand;
      out.signals.push(
        sig(u, {
          ruleId: branded ? "BRAND_KEYWORD_COMBO" : "SUSPICIOUS_HOST_KEYWORDS",
          category: "domain",
          severity: branded || x.suspiciousHostKeywords.length >= 2 ? "MEDIUM" : "LOW",
          impact: branded ? 8 : x.suspiciousHostKeywords.length >= 2 ? 6 : 3,
          title: branded ? "Domain contains suspicious brand-related keywords" : "Domain contains phishing-style keywords",
          description: "Words like 'secure', 'verify' or 'support' are added to make a domain look like an official service page.",
          evidence: `Keywords in hostname: ${x.suspiciousHostKeywords.map((k) => `"${k}"`).join(", ")}`,
        }),
      );
    }
    const hostTokens = x.host.split(/[.\-_]/);
    const lures = Object.entries(LURE_TERMS)
      .map(([theme, words]) => ({ theme, hits: words.filter((w) => hostTokens.includes(w)) }))
      .filter((l) => l.hits.length);
    const lureWords = lures.flatMap((l) => l.hits);
    if (lureWords.length >= 2) {
      out.signals.push(
        sig(u, {
          ruleId: "LURE_TERMS",
          category: "domain",
          severity: "MEDIUM",
          impact: 6,
          title: `Domain uses ${lures.map((l) => l.theme).join("/")}-scam lure words`,
          description: "Combinations like 'parcel + fee' or 'tax + refund' are hallmarks of SMS-phishing and refund-fraud domains.",
          evidence: `Lure words in hostname: ${lureWords.map((w) => `"${w}"`).join(", ")}`,
        }),
      );
    }
    const odd: string[] = [];
    if (x.hyphenCount >= 2) odd.push(`${x.hyphenCount} hyphens`);
    if (x.hostLength > 35) odd.push(`${x.hostLength}-character hostname`);
    if (x.subdomainDepth >= 3) odd.push(`${x.subdomainDepth} subdomain levels`);
    if (x.digitCount >= 4) odd.push(`${x.digitCount} digits`);
    if (odd.length) {
      out.signals.push(sig(u, { ruleId: "UNUSUAL_STRUCTURE", category: "domain", severity: "LOW", impact: 4, title: "Unusual domain structure", description: "Long, hyphen-heavy or deeply nested hostnames are typical of auto-generated phishing infrastructure.", evidence: odd.join(", ") }));
    }
    if (x.suspiciousPathKeywords.length) {
      out.signals.push(sig(u, { ruleId: "SENSITIVE_PATH", category: "domain", severity: "LOW", impact: 4, title: "URL path targets login, verification or claim flows", description: "The path suggests a page that collects credentials or payment data.", evidence: `Path keywords: ${x.suspiciousPathKeywords.map((k) => `"${k}"`).join(", ")}` }));
    }
  },
];

/* ============================== REPUTATION ============================== */

export const reputationRules: Rule[] = [
  (ctx, out) => {
    const r = ctx.rep;
    if (!r) return;
    const mal = r.data.listings.filter((l) => l.verdict === "MALICIOUS");
    const sus = r.data.listings.filter((l) => l.verdict === "SUSPICIOUS");
    const clean = r.data.listings.filter((l) => l.verdict === "CLEAN");
    if (mal.length) {
      out.signals.push(
        sig(r, {
          ruleId: "THREAT_FEED_MALICIOUS",
          category: "reputation",
          severity: "CRITICAL",
          impact: 20,
          title: "Listed as malicious by threat-intelligence feeds",
          description: "The entity is already confirmed malicious by external threat intelligence.",
          evidence: mal.map((l) => `${l.feed}: ${l.category}${l.firstSeen ? ` (first seen ${l.firstSeen.slice(0, 10)})` : ""}`).join("; "),
        }),
      );
      out.adjustments.push({
        kind: "FLOOR",
        value: 85,
        ruleId: "THREAT_FEED_MALICIOUS",
        reason: `Confirmed malicious by ${mal.length} threat feed${mal.length > 1 ? "s" : ""} — score floor of 85 applied`,
      });
    } else if (sus.length) {
      out.signals.push(
        sig(r, {
          ruleId: "THREAT_FEED_SUSPICIOUS",
          category: "reputation",
          severity: "HIGH",
          impact: 12,
          title: "Flagged as suspicious by threat-intelligence feeds",
          description: "External sources have flagged the entity, though not yet confirmed it as malicious.",
          evidence: sus.map((l) => `${l.feed}: ${l.category}`).join("; "),
        }),
      );
    } else if (clean.length && r.data.communityReports === 0) {
      out.signals.push(
        sig(r, {
          ruleId: "REPUTATION_CLEAN",
          category: "reputation",
          severity: "INFO",
          impact: -6,
          title: "Rated clean by reputation sources",
          description: "Reputation sources have positive history for this entity and no abuse reports.",
          evidence: clean.map((l) => `${l.feed}: ${l.category}`).join("; "),
        }),
      );
    }
    const n = r.data.communityReports;
    if (n >= 5) {
      out.signals.push(sig(r, { ruleId: "COMMUNITY_REPORTS", category: "reputation", severity: "MEDIUM", impact: 8, title: "Multiple abuse reports from users", description: "Several independent users have reported this entity.", evidence: `${n} community abuse reports${r.data.lastReportedAt ? `, latest ${r.data.lastReportedAt.slice(0, 10)}` : ""}` }));
    } else if (n > 0) {
      out.signals.push(sig(r, { ruleId: "COMMUNITY_REPORTS", category: "reputation", severity: "LOW", impact: 4, title: "Reported by users", description: "At least one user has reported this entity.", evidence: `${n} community abuse report${n > 1 ? "s" : ""}` }));
    }
  },
  (ctx, out) => {
    const a = ctx.app;
    if (!a) return;
    const { installs, ratingCount, rating } = a.data;
    if (!ctx.isOfficial && installs !== null && installs < 1000 && (ratingCount ?? 0) < 50) {
      out.signals.push(sig(a, { ruleId: "APP_LOW_TRUST", category: "reputation", severity: "LOW", impact: 4, title: "Tiny install base and few reviews", description: "A brand-themed app with almost no users has no community trust signal.", evidence: `${installs.toLocaleString("en-US")} installs, ${ratingCount ?? 0} ratings${rating !== null ? `, average ${rating}` : ""}` }));
    }
    if (installs !== null && installs >= 1_000_000 && (rating ?? 0) >= 4) {
      out.signals.push(sig(a, { ruleId: "APP_WIDELY_TRUSTED", category: "reputation", severity: "INFO", impact: -6, title: "Widely installed with strong ratings", description: "Millions of installs and strong ratings indicate an established, legitimate app.", evidence: `${installs.toLocaleString("en-US")}+ installs, ${rating} average from ${(ratingCount ?? 0).toLocaleString("en-US")} ratings` }));
    }
  },
];

/* ============================== TECHNICAL ============================== */

export const technicalRules: Rule[] = [
  (ctx, out) => {
    const w = ctx.web;
    if (w) {
      if (!w.data.usesTls) {
        out.signals.push(sig(w, { ruleId: "NO_TLS", category: "technical", severity: w.data.hasPasswordField ? "HIGH" : "MEDIUM", impact: w.data.hasPasswordField ? 10 : 6, title: w.data.hasPasswordField ? "Collects passwords over unencrypted HTTP" : "Site is served without HTTPS", description: "No TLS encryption on the final landing page.", evidence: `Final URL: ${w.data.finalUrl}` }));
      }
      const hops = w.data.redirectChain.length - 1;
      if (w.data.crossDomainRedirect || hops >= 2 || w.data.metaRefresh) {
        out.signals.push(
          sig(w, {
            ruleId: "SUSPICIOUS_REDIRECTS",
            category: "technical",
            severity: "MEDIUM",
            impact: 7,
            title: "Suspicious redirect behavior detected",
            description: "Redirect hops through other domains are used to evade scanners and hide the final destination.",
            evidence: `${hops} redirect hop${hops === 1 ? "" : "s"}${w.data.crossDomainRedirect ? " across domains" : ""}${w.data.metaRefresh ? " incl. meta-refresh" : ""}: ${w.data.redirectChain.join(" → ")}`,
          }),
        );
      }
      if (w.data.hasPasswordField && !ctx.isOfficial) {
        const pageReg = splitHost(new URL(w.data.finalUrl).hostname).registrableDomain;
        const foreign = w.data.formActionHosts.filter((h) => splitHost(h).registrableDomain !== pageReg);
        if (foreign.length) {
          out.signals.push(sig(w, { ruleId: "CREDENTIALS_SENT_ELSEWHERE", category: "technical", severity: "HIGH", impact: 10, title: "Login form submits credentials to a different domain", description: "The password form posts to a host unrelated to the page — credentials are exfiltrated to a collection server.", evidence: `Page on ${pageReg}; form action → ${foreign.join(", ")}` }));
        }
      }
      if (w.data.certAgeDays !== null && w.data.certAgeDays < 7 && !ctx.isOfficial) {
        out.signals.push(sig(w, { ruleId: "CERT_FRESH", category: "technical", severity: "LOW", impact: 3, title: "TLS certificate issued in the last week", description: "Freshly issued certificates on brand-themed sites often accompany new phishing deployments.", evidence: `${w.data.certIssuer ?? "Certificate"} issued ${w.data.certAgeDays} days ago` }));
      }
    } else if (ctx.url?.data.usesHttps === false) {
      out.signals.push(sig(ctx.url, { ruleId: "NO_TLS", category: "technical", severity: "MEDIUM", impact: 6, title: "URL uses plain HTTP", description: "The submitted URL is not encrypted.", evidence: `Scheme: http` }));
    }
    const u = ctx.url;
    if (u && (u.data.hasAtSymbol || u.data.nonStandardPort)) {
      out.signals.push(sig(u, { ruleId: "URL_OBFUSCATION", category: "technical", severity: "MEDIUM", impact: 6, title: "URL obfuscation technique", description: "An '@' in the authority or a non-standard port is used to disguise where a link really goes.", evidence: [u.data.hasAtSymbol ? "'@' in URL authority" : "", u.data.nonStandardPort ? `port ${u.data.nonStandardPort}` : ""].filter(Boolean).join(", ") }));
    }
  },
  (ctx, out) => {
    const a = ctx.app;
    if (!a || ctx.isOfficial) return;
    const dangerous = a.data.permissions.filter((p) => DANGEROUS_PERMISSIONS[p]);
    if (dangerous.length) {
      out.signals.push(
        sig(a, {
          ruleId: "DANGEROUS_PERMISSIONS",
          category: "technical",
          severity: dangerous.length >= 2 ? "HIGH" : "MEDIUM",
          impact: dangerous.length >= 2 ? 10 : 6,
          title: `Requests ${dangerous.length} high-risk permission${dangerous.length > 1 ? "s" : ""}`,
          description: "These permissions enable OTP interception, overlay phishing or remote control — the toolkit of banking trojans.",
          evidence: dangerous.map((p) => `${p.replace("android.permission.", "")} (${DANGEROUS_PERMISSIONS[p]})`).join("; "),
        }),
      );
    }
    if (!a.data.officialStore) {
      out.signals.push(sig(a, { ruleId: "SIDELOADED_APP", category: "technical", severity: "MEDIUM", impact: 7, title: "Distributed outside official app stores", description: "Sideloaded apps bypass store security review.", evidence: `Distribution channel: ${a.data.store}` }));
    }
  },
];
