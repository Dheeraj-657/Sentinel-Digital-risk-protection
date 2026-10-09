import type { Rule, RuleContext, SignalDraft } from "./context";
import { sig, textMentionsBrand } from "./context";
import { bestBrandMatch, findPhrases } from "../similarity";
import { splitHost } from "../entity";
import { isOfficialHost } from "../providers/local/brand-similarity";
import { SUPPORT_TERMS, VERIFICATION_LOOKALIKES } from "../lexicon";

const pct = (n: number) => `${Math.round(n * 100)}%`;

/* ============================ BRAND SIMILARITY ============================ */

export const brandSimilarityRules: Rule[] = [
  // Identifier vs brand (typosquat / homoglyph / contains)
  (ctx, out) => {
    const bs = ctx.brandSim;
    if (!bs || ctx.isOfficial) return;
    const m = bs.data.primary;
    const what =
      ctx.entity.type === "PROFILE" ? "Username" : ctx.entity.type === "APP" ? "Package name" : "Domain name";
    if (m.kind === "HOMOGLYPH") {
      out.signals.push(
        sig(bs, {
          ruleId: "BRAND_HOMOGLYPH",
          category: "brandSimilarity",
          severity: "CRITICAL",
          impact: 18,
          title: `${what} uses look-alike characters to imitate ${bs.data.brandName}`,
          description: "Characters such as 0/o, 1/l or Cyrillic letters are swapped in so the name reads as the brand at a glance.",
          evidence: m.detail,
        }),
      );
    } else if (m.kind === "TYPOSQUAT") {
      out.signals.push(
        sig(bs, {
          ruleId: "BRAND_TYPOSQUAT",
          category: "brandSimilarity",
          severity: "HIGH",
          impact: 13,
          title: `${what} is a typosquat of ${bs.data.brandName}`,
          description: "The name differs from the brand by only one or two character edits — a classic typosquatting pattern.",
          evidence: m.detail,
        }),
      );
    } else if (m.kind === "CONTAINS" || m.kind === "EXACT") {
      const title =
        ctx.entity.type === "PROFILE"
          ? `Username is highly similar to the protected brand`
          : ctx.entity.type === "APP"
            ? `Package name embeds the ${bs.data.brandName} brand`
            : `Domain uses the ${bs.data.brandName} name but is not an official domain`;
      out.signals.push(
        sig(bs, {
          ruleId: "BRAND_NAME_IN_IDENTIFIER",
          category: "brandSimilarity",
          severity: "HIGH",
          impact: 12,
          title,
          description: "The identifier contains the brand name, yet it is not one of the brand's registered official assets.",
          evidence: m.detail,
        }),
      );
    } else if (m.kind === "SIMILAR") {
      out.signals.push(
        sig(bs, {
          ruleId: "BRAND_SIMILAR",
          category: "brandSimilarity",
          severity: "MEDIUM",
          impact: 6,
          title: `${what} resembles ${bs.data.brandName}`,
          description: "Moderate lexical similarity to the brand name.",
          evidence: m.detail,
        }),
      );
    }
  },
  // Brand in subdomain / path of an unrelated domain
  (ctx, out) => {
    const bs = ctx.brandSim;
    if (!bs || ctx.isOfficial) return;
    if (bs.data.subdomainMatch) {
      out.signals.push(
        sig(bs, {
          ruleId: "BRAND_IN_SUBDOMAIN",
          category: "brandSimilarity",
          severity: "HIGH",
          impact: 12,
          title: `Brand name placed in the subdomain of an unrelated domain`,
          description: "Putting the brand in the subdomain (brand.attacker-domain.tld) makes the URL look official while the real owner is someone else.",
          evidence: `Subdomain "${ctx.entity.subdomain}" on ${ctx.entity.registrableDomain}: ${bs.data.subdomainMatch.detail}`,
        }),
      );
    }
    if (bs.data.pathMatch) {
      out.signals.push(
        sig(bs, {
          ruleId: "BRAND_IN_PATH",
          category: "brandSimilarity",
          severity: "MEDIUM",
          impact: 6,
          title: "Brand name used in the URL path",
          description: "The brand appears in the path of a domain the brand does not own.",
          evidence: `Path "${ctx.entity.path}": ${bs.data.pathMatch.detail}`,
        }),
      );
    }
  },
  // Copied logo / avatar / icon
  (ctx, out) => {
    if (!ctx.brand || ctx.isOfficial) return;
    const cands = [
      ctx.social && ctx.social.data.avatarLogoSimilarity !== null
        ? { src: ctx.social, v: ctx.social.data.avatarLogoSimilarity, title: "Profile uses a copied brand logo", what: "Profile picture" }
        : null,
      ctx.web && ctx.web.data.logoSimilarity !== null
        ? { src: ctx.web, v: ctx.web.data.logoSimilarity, title: "Page displays the brand's logo", what: "Logo on page" }
        : null,
      ctx.app && ctx.app.data.iconSimilarity !== null
        ? { src: ctx.app, v: ctx.app.data.iconSimilarity, title: "App icon copies the brand logo", what: "App icon" }
        : null,
    ].filter((c): c is NonNullable<typeof c> => Boolean(c));
    for (const c of cands) {
      if (c.v >= 0.85) {
        out.signals.push(
          sig(c.src, {
            ruleId: "LOGO_COPIED",
            category: "brandSimilarity",
            severity: "HIGH",
            impact: 14,
            title: c.title,
            description: "Perceptual image comparison shows the brand logo is reused on an asset the brand doesn't own.",
            evidence: `${c.what} is ${pct(c.v)} visually similar to the ${ctx.brand.name} logo`,
          }),
        );
      } else if (c.v >= 0.7) {
        out.signals.push(
          sig(c.src, {
            ruleId: "LOGO_SIMILAR",
            category: "brandSimilarity",
            severity: "MEDIUM",
            impact: 7,
            title: `${c.what} resembles the brand logo`,
            description: "Partial visual similarity to the brand logo (altered colours or crop).",
            evidence: `${c.what} is ${pct(c.v)} visually similar to the ${ctx.brand.name} logo`,
          }),
        );
      }
    }
  },
];

/* ============================ IMPERSONATION ============================ */

function lookalikeHosts(ctx: RuleContext, urls: string[]): { url: string; detail: string }[] {
  if (!ctx.brand) return [];
  const out: { url: string; detail: string }[] = [];
  for (const u of urls) {
    let host: string;
    try {
      host = new URL(u.includes("://") ? u : `https://${u}`).hostname.toLowerCase();
    } catch {
      continue;
    }
    if (isOfficialHost(host, ctx.brand)) continue;
    const { registrableDomain, tld, subdomain } = splitHost(host);
    const label = tld ? registrableDomain.slice(0, -(tld.length + 1)) : registrableDomain;
    const m = bestBrandMatch([subdomain, label].filter(Boolean).join("."), ctx.brandTerms);
    if (m.kind !== "NONE" && m.kind !== "SIMILAR") out.push({ url: u, detail: m.detail });
  }
  return out;
}

export const impersonationRules: Rule[] = [
  // Official asset — strong mitigation, and suppresses impersonation rules
  (ctx, out) => {
    if (!ctx.isOfficial || !ctx.brandSim || !ctx.brand) return;
    const what =
      ctx.entity.type === "APP"
        ? `Package ${ctx.entity.packageName} is in the official namespace and published by ${ctx.app?.data.developerName} on ${ctx.app?.data.store}`
        : `${ctx.brandSim.data.officialAssetMatched} is a registered official ${ctx.brand.name} asset`;
    out.signals.push(
      sig(ctx.app ?? ctx.brandSim, {
        ruleId: "OFFICIAL_ASSET",
        category: "impersonation",
        severity: "INFO",
        impact: -20,
        title: `Matches an official ${ctx.brand.name} asset`,
        description: "The entity is listed among the brand's official domains, accounts or app publishers, so impersonation risk is removed.",
        evidence: what,
      }),
    );
  },
  // Name / title claims to be the brand
  (ctx, out) => {
    if (!ctx.brand || ctx.isOfficial) return;
    const items = [
      ctx.social && textMentionsBrand(ctx.social.data.displayName, ctx.brandTerms)
        ? { src: ctx.social, title: `Display name claims to be ${ctx.brand.name}`, ev: `Display name: "${ctx.social.data.displayName}"` }
        : null,
      ctx.web && textMentionsBrand(ctx.web.data.title, ctx.brandTerms)
        ? { src: ctx.web, title: `Page presents itself as ${ctx.brand.name}`, ev: `Page title: "${ctx.web.data.title}" (${ctx.web.data.brandMentions} brand mentions)` }
        : null,
      ctx.app && textMentionsBrand(ctx.app.data.appName, ctx.brandTerms)
        ? { src: ctx.app, title: `App name claims to be ${ctx.brand.name}`, ev: `App name: "${ctx.app.data.appName}"` }
        : null,
    ].filter((x): x is NonNullable<typeof x> => Boolean(x));
    for (const i of items) {
      out.signals.push(
        sig(i.src, {
          ruleId: "NAME_CLAIMS_BRAND",
          category: "impersonation",
          severity: "HIGH",
          impact: 12,
          title: i.title,
          description: "The entity uses the brand's name to present itself, but is not an official asset.",
          evidence: i.ev,
        }),
      );
    }
  },
  // Fake verification / "official" claims
  (ctx, out) => {
    if (ctx.isOfficial) return;
    if (ctx.social && !ctx.social.data.platformVerified) {
      const found = findPhrases(`${ctx.social.data.displayName} ${ctx.social.data.bio}`, VERIFICATION_LOOKALIKES);
      if (found.length) {
        out.signals.push(
          sig(ctx.social, {
            ruleId: "FAKE_VERIFICATION",
            category: "impersonation",
            severity: "MEDIUM",
            impact: 8,
            title: "Claims to be verified/official without platform verification",
            description: "Check-mark emoji or words like 'official' are used in the name or bio, but the platform has not verified the account.",
            evidence: `Found ${found.map((f) => `"${f}"`).join(", ")}; platform verification: none`,
          }),
        );
      }
    }
    if (ctx.app && ctx.brand && ctx.claimsBrand && /official/i.test(`${ctx.app.data.appName} ${ctx.app.data.description}`)) {
      out.signals.push(
        sig(ctx.app, {
          ruleId: "FAKE_VERIFICATION",
          category: "impersonation",
          severity: "MEDIUM",
          impact: 8,
          title: "App listing claims to be 'official'",
          description: "The listing describes itself as official while not being published by the brand.",
          evidence: `Description: "${ctx.app.data.description.slice(0, 140)}"`,
        }),
      );
    }
  },
  // Poses as customer support
  (ctx, out) => {
    const bs = ctx.brandSim;
    if (!bs || ctx.isOfficial) return;
    const support = bs.data.pairedKeywords.filter((k) => SUPPORT_TERMS.includes(k));
    if (!support.length) return;
    out.signals.push(
      sig(bs, {
        ruleId: "SUPPORT_IMPERSONATION",
        category: "impersonation",
        severity: "HIGH",
        impact: 10,
        title: `Poses as ${bs.data.brandName} customer support`,
        description: "Fake support channels are a common way to harvest account details from customers seeking help.",
        evidence: `Identifier pairs the brand with: ${support.map((s) => `"${s}"`).join(", ")}`,
      }),
    );
  },
  // Third party registered a domain built from the brand name
  (ctx, out) => {
    const bs = ctx.brandSim;
    if (!bs || !ctx.brand || ctx.isOfficial) return;
    if (ctx.entity.type !== "DOMAIN" && ctx.entity.type !== "WEBSITE") return;
    if (!["CONTAINS", "HOMOGLYPH", "TYPOSQUAT"].includes(bs.data.primary.kind)) return;
    const d = ctx.domain?.data;
    const regOrg = d?.registrantOrg ?? null;
    const ownedByBrand = regOrg !== null && ctx.brandTerms.some((t) => regOrg.toLowerCase().replace(/[^a-z0-9]/g, "").includes(t));
    if (ownedByBrand) return;
    const reasons: string[] = [];
    if (d?.ageDays !== null && d?.ageDays !== undefined && d.ageDays < 180) reasons.push(`registered ${d.ageDays} days ago`);
    if (d?.privacyProtected) reasons.push("registrant hidden");
    if (ctx.url?.data.riskyTld) reasons.push(`high-abuse .${ctx.url.data.tld} TLD`);
    if (!reasons.length) return;
    out.signals.push(
      sig(ctx.domain ?? bs, {
        ruleId: "UNAUTHORIZED_BRAND_DOMAIN",
        category: "impersonation",
        severity: "HIGH",
        impact: 10,
        title: `Look-alike ${ctx.brand.name} domain registered by a third party`,
        description: "A domain built from the brand name that the brand does not own, combined with throwaway registration traits, is set up to be mistaken for the brand.",
        evidence: `${ctx.entity.registrableDomain}: ${bs.data.primary.detail}; ${reasons.join(", ")}; not in official domains (${ctx.brand.officialDomains.join(", ") || "none on file"})`,
      }),
    );
  },
  // Brand-themed credential form
  (ctx, out) => {
    if (!ctx.web || ctx.isOfficial || !ctx.claimsBrand || !ctx.web.data.hasPasswordField) return;
    out.signals.push(
      sig(ctx.web, {
        ruleId: "BRANDED_CREDENTIAL_FORM",
        category: "impersonation",
        severity: "CRITICAL",
        impact: 18,
        title: "Brand-themed login form on a non-official site",
        description: "A password field on a page imitating the brand is the defining trait of credential phishing.",
        evidence: `Password input found on ${ctx.web.data.finalUrl}; form posts to ${ctx.web.data.formActionHosts.join(", ") || "same page"}`,
      }),
    );
  },
  // App developer mismatch
  (ctx, out) => {
    if (!ctx.app || !ctx.brand || ctx.isOfficial || !ctx.claimsBrand) return;
    const dev = ctx.app.data.developerName;
    if (ctx.brand.appDevelopers.some((d) => d.toLowerCase() === dev.toLowerCase())) return;
    out.signals.push(
      sig(ctx.app, {
        ruleId: "DEVELOPER_MISMATCH",
        category: "impersonation",
        severity: "CRITICAL",
        impact: 16,
        title: "Developer identity does not match the claimed brand",
        description: "The app presents itself as the brand but is published by a different developer account.",
        evidence: `Listed developer "${dev}"; official ${ctx.brand.name} developers: ${ctx.brand.appDevelopers.join(", ") || "none on file"}`,
      }),
    );
  },
  // Links to look-alike domains
  (ctx, out) => {
    if (!ctx.brand || ctx.isOfficial) return;
    const sources = [
      ctx.social ? { src: ctx.social, urls: ctx.social.data.externalLinks } : null,
      ctx.web ? { src: ctx.web, urls: ctx.web.data.externalLinks } : null,
      ctx.app && ctx.app.data.developerWebsite ? { src: ctx.app, urls: [ctx.app.data.developerWebsite] } : null,
    ].filter((x): x is NonNullable<typeof x> => Boolean(x));
    for (const s of sources) {
      const hits = lookalikeHosts(ctx, s.urls).filter((h) => {
        try {
          return new URL(h.url).hostname !== ctx.entity.host;
        } catch {
          return true;
        }
      });
      if (!hits.length) continue;
      out.signals.push(
        sig(s.src, {
          ruleId: "LINKS_TO_LOOKALIKE",
          category: "impersonation",
          severity: "HIGH",
          impact: 10,
          title: "Links to a look-alike brand domain",
          description: "The entity sends users to a domain that imitates the brand but is not official — typically the payload site.",
          evidence: hits.map((h) => `${h.url} (${h.detail})`).join("; "),
        }),
      );
    }
  },
];

/** Derived rule — runs after all others. */
export function multiIndicatorRule(ctx: RuleContext, signals: SignalDraft[]): SignalDraft | null {
  if (ctx.isOfficial) return null;
  const hits = signals.filter(
    (s) => (s.category === "impersonation" || s.category === "brandSimilarity") && s.impact > 0,
  );
  const distinct = [...new Set(hits.map((s) => s.ruleId))];
  if (distinct.length < 3) return null;
  return {
    ruleId: "MULTIPLE_IMPERSONATION_INDICATORS",
    category: "impersonation",
    severity: "MEDIUM",
    impact: 6,
    title: "Multiple impersonation indicators detected",
    description: "Several independent impersonation techniques are combined, which is rare for legitimate fan or reseller pages.",
    evidence: `${distinct.length} independent indicators: ${hits.map((h) => h.title).slice(0, 5).join("; ")}`,
    provider: "Risk Engine (correlation)",
    origin: "COMPUTED",
    reliability: 0.9,
  };
}
