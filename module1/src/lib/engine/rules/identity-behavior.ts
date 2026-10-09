import type { Rule } from "./context";
import { sig } from "./context";
import { bestBrandMatch, findPhrases, slug } from "../similarity";
import { FREE_EMAIL_DOMAINS, SCAM_PHRASES } from "../lexicon";
import { isOfficialHost } from "../providers/local/brand-similarity";
import { splitHost } from "../entity";

/* ============================== IDENTITY ============================== */

export const identityRules: Rule[] = [
  // Account age
  (ctx, out) => {
    const s = ctx.social;
    if (!s || s.data.accountAgeDays === null) return;
    const d = s.data.accountAgeDays;
    if (d < 30) {
      out.signals.push(
        sig(s, {
          ruleId: "ACCOUNT_NEW",
          category: "identity",
          severity: "HIGH",
          impact: 12,
          title: "Account was created very recently",
          description: "Impersonation accounts are usually days or weeks old because they are taken down and recreated.",
          evidence: `Account age: ${d} days`,
        }),
      );
    } else if (d < 90) {
      out.signals.push(
        sig(s, {
          ruleId: "ACCOUNT_YOUNG",
          category: "identity",
          severity: "MEDIUM",
          impact: 7,
          title: "Account is less than 3 months old",
          description: "A young account has little history to establish trust.",
          evidence: `Account age: ${d} days`,
        }),
      );
    }
  },
  // App listing age
  (ctx, out) => {
    const a = ctx.app;
    if (!a || a.data.publishedDaysAgo === null || ctx.isOfficial) return;
    if (a.data.publishedDaysAgo < 30) {
      out.signals.push(
        sig(a, {
          ruleId: "APP_LISTING_NEW",
          category: "identity",
          severity: "MEDIUM",
          impact: 8,
          title: "App listing was published very recently",
          description: "A brand-new listing has no track record and is typical of short-lived clone apps.",
          evidence: `Published ${a.data.publishedDaysAgo} days ago on ${a.data.store}`,
        }),
      );
    }
  },
  // Hidden registrant
  (ctx, out) => {
    const d = ctx.domain;
    if (!d || ctx.isOfficial || !d.data.privacyProtected) return;
    if (!(ctx.claimsBrand || (d.data.ageDays !== null && d.data.ageDays < 180))) return;
    out.signals.push(
      sig(d, {
        ruleId: "REGISTRANT_HIDDEN",
        category: "identity",
        severity: "LOW",
        impact: 4,
        title: "Domain owner identity is hidden",
        description: "Privacy-protected registration on a new or brand-themed domain prevents attribution of the owner.",
        evidence: `Registrant: privacy-protected via ${d.data.registrar ?? "unknown registrar"}`,
      }),
    );
  },
  // Contact info: free webmail or look-alike email domain
  (ctx, out) => {
    if (ctx.isOfficial) return;
    const sources = [
      ctx.web ? { src: ctx.web, emails: ctx.web.data.contactEmails } : null,
      ctx.social ? { src: ctx.social, emails: ctx.social.data.contactEmails } : null,
      ctx.app && ctx.app.data.developerEmail ? { src: ctx.app, emails: [ctx.app.data.developerEmail] } : null,
    ].filter((x): x is NonNullable<typeof x> => Boolean(x));
    for (const s of sources) {
      const free = s.emails.filter((e) => FREE_EMAIL_DOMAINS.has(e.split("@")[1] ?? ""));
      if (free.length && ctx.claimsBrand) {
        out.signals.push(
          sig(s.src, {
            ruleId: "CONTACT_FREE_EMAIL",
            category: "identity",
            severity: "MEDIUM",
            impact: 8,
            title: "Uses a free webmail address while claiming to be the brand",
            description: "Genuine brand channels use the brand's own email domain, not consumer webmail.",
            evidence: `Contact: ${free.join(", ")}`,
          }),
        );
      }
      if (!ctx.brand) continue;
      const look = s.emails.filter((e) => {
        const host = e.split("@")[1] ?? "";
        if (!host || isOfficialHost(host, ctx.brand!) || FREE_EMAIL_DOMAINS.has(host)) return false;
        const { registrableDomain, tld } = splitHost(host);
        const m = bestBrandMatch(registrableDomain.slice(0, -(tld.length + 1)), ctx.brandTerms);
        return m.kind !== "NONE" && m.kind !== "SIMILAR";
      });
      if (look.length) {
        out.signals.push(
          sig(s.src, {
            ruleId: "CONTACT_LOOKALIKE_DOMAIN",
            category: "identity",
            severity: "HIGH",
            impact: 10,
            title: "Contact email uses a look-alike brand domain",
            description: "The contact address imitates the brand's domain — a strong sign of deliberate impersonation.",
            evidence: `Contact: ${look.join(", ")}`,
          }),
        );
      }
    }
  },
  // Mitigations — identity matches the brand / is public
  (ctx, out) => {
    const d = ctx.domain;
    if (d && d.data.registrantOrg && ctx.brand && slug(d.data.registrantOrg).includes(slug(ctx.brand.name))) {
      out.signals.push(
        sig(d, {
          ruleId: "REGISTRANT_MATCHES_BRAND",
          category: "identity",
          severity: "INFO",
          impact: -10,
          title: "Registrant organisation matches the brand",
          description: "The domain is registered to the protected brand's own organisation.",
          evidence: `Registrant org: ${d.data.registrantOrg}`,
        }),
      );
    } else if (d && d.data.registrantOrg && !d.data.privacyProtected && (d.data.ageDays ?? 0) > 730) {
      out.signals.push(
        sig(d, {
          ruleId: "REGISTRANT_PUBLIC",
          category: "identity",
          severity: "INFO",
          impact: -5,
          title: "Registrant identity is public and long-standing",
          description: "An identifiable owner on a domain older than two years lowers identity risk.",
          evidence: `Registrant org: ${d.data.registrantOrg}; registered ${d.data.ageDays} days ago`,
        }),
      );
    }
    if (ctx.social?.data.platformVerified) {
      out.signals.push(
        sig(ctx.social, {
          ruleId: "PLATFORM_VERIFIED",
          category: "identity",
          severity: "INFO",
          impact: -10,
          title: "Account is verified by the platform",
          description: "The social platform has verified the account holder's identity.",
          evidence: `${ctx.social.data.platform} verification badge present`,
        }),
      );
    }
    if (ctx.app && ctx.brand && ctx.brand.appDevelopers.some((x) => x.toLowerCase() === ctx.app!.data.developerName.toLowerCase())) {
      out.signals.push(
        sig(ctx.app, {
          ruleId: "DEVELOPER_MATCHES_BRAND",
          category: "identity",
          severity: "INFO",
          impact: -10,
          title: "Publisher is an official brand developer account",
          description: "The app is published by a developer account registered to the brand.",
          evidence: `Developer: ${ctx.app.data.developerName}`,
        }),
      );
    }
  },
];

/* ============================== BEHAVIORAL ============================== */

export const behavioralRules: Rule[] = [
  // Scam language across bio / page / app description
  (ctx, out) => {
    if (ctx.isOfficial) return;
    const sources = [
      ctx.social ? { src: ctx.social, text: `${ctx.social.data.bio} ${ctx.social.data.recentPostThemes.join(" ")}`, where: "profile bio/posts" } : null,
      ctx.web ? { src: ctx.web, text: ctx.web.data.scamPhrases.join(" | "), where: "page content" } : null,
      ctx.app ? { src: ctx.app, text: ctx.app.data.description, where: "app description" } : null,
    ].filter((x): x is NonNullable<typeof x> => Boolean(x));
    const themes = ["credential", "urgency", "giveaway"] as const;
    for (const s of sources) {
      const found: Record<string, string[]> = {};
      for (const th of themes) {
        const f = findPhrases(s.text, SCAM_PHRASES[th]);
        if (f.length) found[th] = f;
      }
      const n = Object.keys(found).length;
      if (!n) continue;
      const phrases = Object.values(found).flat();
      out.signals.push(
        sig(s.src, {
          ruleId: "SCAM_LANGUAGE",
          category: "behavioral",
          severity: n >= 2 ? "HIGH" : "MEDIUM",
          impact: n >= 2 ? 9 : 6,
          title: "Scam and pressure language detected",
          description: `Language patterns typical of fraud (${Object.keys(found).join(", ")}) appear in the ${s.where}.`,
          evidence: phrases.slice(0, 6).map((p) => `"${p}"`).join(", "),
        }),
      );
    }
  },
  // Off-platform / DM solicitation
  (ctx, out) => {
    if (!ctx.social || ctx.isOfficial) return;
    const f = findPhrases(ctx.social.data.bio, SCAM_PHRASES.solicitation);
    if (!f.length) return;
    out.signals.push(
      sig(ctx.social, {
        ruleId: "OFFPLATFORM_SOLICITATION",
        category: "behavioral",
        severity: "MEDIUM",
        impact: 7,
        title: "Asks users to share details via DM or off-platform channels",
        description: "Moving victims to DMs, WhatsApp or Telegram avoids platform moderation and is a hallmark of support scams.",
        evidence: `Bio contains ${f.map((p) => `"${p}"`).join(", ")}`,
      }),
    );
  },
  // Crypto giveaway / send-to-receive
  (ctx, out) => {
    if (ctx.isOfficial) return;
    const s = ctx.social ?? ctx.web;
    if (!s) return;
    const text = ctx.social
      ? `${ctx.social.data.bio} ${ctx.social.data.recentPostThemes.join(" ")}`
      : (ctx.web?.data.scamPhrases.join(" ") ?? "");
    const crypto = findPhrases(text, SCAM_PHRASES.crypto);
    const give = findPhrases(text, SCAM_PHRASES.giveaway);
    if (!crypto.length || !give.length) return;
    out.signals.push(
      sig(s, {
        ruleId: "CRYPTO_GIVEAWAY",
        category: "behavioral",
        severity: "HIGH",
        impact: 10,
        title: "Crypto giveaway / 'send to receive' pattern",
        description: "Promising to multiply crypto sent to a wallet is an advance-fee scam with no legitimate equivalent.",
        evidence: `Crypto terms ${crypto.map((p) => `"${p}"`).join(", ")} combined with ${give.map((p) => `"${p}"`).join(", ")}`,
      }),
    );
  },
  // Audience anomalies & posting bursts
  (ctx, out) => {
    const s = ctx.social;
    if (!s || ctx.isOfficial) return;
    const { followers, following, postsLast7Days, accountAgeDays } = s.data;
    if (following > 500 && following > followers * 5) {
      out.signals.push(
        sig(s, {
          ruleId: "AUDIENCE_ANOMALY",
          category: "behavioral",
          severity: "LOW",
          impact: 4,
          title: "Follows far more accounts than follow it",
          description: "Mass-following to gain visibility is typical of bot-driven or scam accounts.",
          evidence: `${following.toLocaleString("en-US")} following vs ${followers.toLocaleString("en-US")} followers`,
        }),
      );
    }
    if (postsLast7Days !== null && postsLast7Days >= 20 && (accountAgeDays ?? 999) < 60) {
      out.signals.push(
        sig(s, {
          ruleId: "POSTING_BURST",
          category: "behavioral",
          severity: "MEDIUM",
          impact: 5,
          title: "Burst of posting on a new account",
          description: "High-volume posting immediately after creation suggests a campaign rather than an organic account.",
          evidence: `${postsLast7Days} posts in the last 7 days; account age ${accountAgeDays} days`,
        }),
      );
    }
    if (followers >= 100_000 && (accountAgeDays ?? 0) > 1095) {
      out.signals.push(
        sig(s, {
          ruleId: "ESTABLISHED_AUDIENCE",
          category: "behavioral",
          severity: "INFO",
          impact: -5,
          title: "Large, long-established audience",
          description: "A large following built over years is hard to fake and lowers behavioural risk.",
          evidence: `${followers.toLocaleString("en-US")} followers; account age ${accountAgeDays} days`,
        }),
      );
    }
  },
];
