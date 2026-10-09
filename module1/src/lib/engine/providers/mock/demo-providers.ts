/**
 * Mock/demo intelligence providers. They read the curated dataset in `src/lib/demo/dataset.ts`.
 * Unknown subjects return NO_DATA — mocks never fabricate evidence.
 *
 * To plug in a real vendor, implement IntelProvider<T> for the same `kind` and map the vendor
 * response onto the contract in `../contracts.ts`, then register it in `../registry.ts`.
 */
import type { IntelProvider } from "../../types";
import type { AppIntelData, DomainIntelData, ReputationData, SocialProfileData, WebContentData } from "../contracts";
import { DEMO_APPS, DEMO_DOMAINS, DEMO_REPUTATION, DEMO_SOCIAL, DEMO_WEB } from "@/lib/demo/dataset";

const DAY = 86_400_000;
const daysAgoIso = (d: number | null) => (d === null ? null : new Date(Date.now() - d * DAY).toISOString());

/** Small deterministic delay so the demo pipeline behaves like real network calls. */
async function simulatedLatency(key: string, signal: AbortSignal) {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const ms = 120 + (h % 260);
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new Error("aborted"));
    });
  });
}

export const demoDomainIntelProvider: IntelProvider<DomainIntelData> = {
  id: "demo.domain-intel",
  name: "Domain Registration Intel (demo WHOIS)",
  kind: "domain-intel",
  origin: "DEMO",
  reliability: 0.8,
  timeoutMs: 4000,
  supports: (e) => e.type === "WEBSITE" || e.type === "DOMAIN",
  async collect({ entity, signal }) {
    const domain = entity.registrableDomain!;
    await simulatedLatency(domain, signal);
    const r = DEMO_DOMAINS[domain];
    if (!r) return { status: "NO_DATA", data: null, message: `No registration record for ${domain} in demo dataset` };
    return {
      status: "OK",
      data: {
        domain,
        createdAt: daysAgoIso(r.createdDaysAgo),
        ageDays: r.createdDaysAgo,
        registrar: r.registrar,
        registrantOrg: r.registrantOrg,
        privacyProtected: r.privacyProtected,
        nameservers: r.nameservers,
        hasMx: r.hasMx,
        hostingAsn: r.hostingAsn,
        hostingCountry: r.hostingCountry,
        popularityRank: r.popularityRank,
      },
    };
  },
};

export const demoReputationProvider: IntelProvider<ReputationData> = {
  id: "demo.reputation",
  name: "Threat Feeds & Reputation (demo)",
  kind: "reputation",
  origin: "DEMO",
  reliability: 0.85,
  timeoutMs: 4000,
  supports: () => true,
  async collect({ entity, signal }) {
    const keys =
      entity.type === "PROFILE" || entity.type === "APP"
        ? [entity.target]
        : [entity.host!, entity.registrableDomain!].filter(Boolean);
    await simulatedLatency(keys.join("|"), signal);
    const subject = keys.find((k) => DEMO_REPUTATION[k]);
    if (!subject) return { status: "NO_DATA", data: null, message: "Subject not present in demo threat feeds" };
    const r = DEMO_REPUTATION[subject];
    return {
      status: "OK",
      data: {
        subject,
        listings: r.listings.map((l) => ({ ...l, firstSeen: daysAgoIso(l.firstSeenDaysAgo) })),
        communityReports: r.communityReports,
        lastReportedAt: daysAgoIso(r.lastReportedDaysAgo),
      },
    };
  },
};

export const demoWebContentProvider: IntelProvider<WebContentData> = {
  id: "demo.web-content",
  name: "Page Crawler & Redirect Tracer (demo)",
  kind: "web-content",
  origin: "DEMO",
  reliability: 0.8,
  timeoutMs: 5000,
  supports: (e) => e.type === "WEBSITE",
  async collect({ entity, signal }) {
    const pathKey = `${entity.host}${new URL(entity.url!).pathname.replace(/\/$/, "")}`;
    await simulatedLatency(pathKey, signal);
    const r = DEMO_WEB[pathKey] ?? DEMO_WEB[entity.host!] ?? DEMO_WEB[entity.registrableDomain!];
    if (!r) return { status: "NO_DATA", data: null, message: "Page not present in demo crawl cache" };
    const chain = r.redirectChain;
    const hostOf = (u: string) => new URL(u).hostname;
    const regOf = (h: string) => h.split(".").slice(-2).join(".");
    return {
      status: "OK",
      data: {
        requestedUrl: entity.url!,
        finalUrl: chain[chain.length - 1],
        statusCode: r.statusCode,
        redirectChain: chain,
        crossDomainRedirect: new Set(chain.map((u) => regOf(hostOf(u)))).size > 1,
        usesTls: r.usesTls,
        certIssuer: r.certIssuer,
        certAgeDays: r.certAgeDays,
        title: r.title,
        hasPasswordField: r.hasPasswordField,
        formActionHosts: r.formActionHosts,
        brandMentions: r.brandMentions,
        logoSimilarity: r.logoSimilarity,
        scamPhrases: r.scamPhrases,
        contactEmails: r.contactEmails,
        externalLinks: r.externalLinks,
        metaRefresh: r.metaRefresh,
      },
    };
  },
};

export const demoSocialProvider: IntelProvider<SocialProfileData> = {
  id: "demo.social-intel",
  name: "Social Profile Intelligence (demo)",
  kind: "social-intel",
  origin: "DEMO",
  reliability: 0.75,
  timeoutMs: 4000,
  supports: (e) => e.type === "PROFILE",
  async collect({ entity, signal }) {
    await simulatedLatency(entity.target, signal);
    const r = DEMO_SOCIAL[entity.target];
    if (!r) return { status: "NO_DATA", data: null, message: "Profile not present in demo social dataset" };
    return { status: "OK", data: { platform: entity.platform!, handle: entity.handle!, ...r } };
  },
};

export const demoAppProvider: IntelProvider<AppIntelData> = {
  id: "demo.app-intel",
  name: "App Store Intelligence (demo)",
  kind: "app-intel",
  origin: "DEMO",
  reliability: 0.8,
  timeoutMs: 4000,
  supports: (e) => e.type === "APP",
  async collect({ entity, signal }) {
    await simulatedLatency(entity.packageName!, signal);
    const r = DEMO_APPS[entity.packageName!];
    if (!r) return { status: "NO_DATA", data: null, message: "App not present in demo store dataset" };
    return { status: "OK", data: { packageName: entity.packageName!, ...r } };
  },
};
