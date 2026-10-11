/**
 * LIVE providers (INTEL_MODE=live). Free, keyless, real lookups:
 *  - RDAP (the IETF successor to WHOIS) for domain registration data
 *  - A guarded HTTP client that traces redirects and inspects the landing page
 */
import { promises as dns } from "node:dns";
import net from "node:net";
import { guardedRequest } from "../../net-guard";
import type { IntelProvider } from "../../types";
import type { DomainIntelData, WebContentData } from "../contracts";
import { SCAM_PHRASES } from "../../lexicon";
import { brandTerms } from "../local/brand-similarity";
import { splitHost } from "../../entity";

/* ---------------- RDAP ---------------- */

interface RdapEntity {
  roles?: string[];
  vcardArray?: [string, [string, Record<string, unknown>, string, unknown][]];
  remarks?: { title?: string; description?: string[] }[];
}
interface RdapDomain {
  events?: { eventAction: string; eventDate: string }[];
  entities?: RdapEntity[];
  nameservers?: { ldhName?: string }[];
  remarks?: { title?: string; description?: string[] }[];
}

function vcardValue(e: RdapEntity, key: string): string | null {
  const row = e.vcardArray?.[1]?.find((r) => r[0] === key);
  const v = row?.[3];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export const rdapDomainProvider: IntelProvider<DomainIntelData> = {
  id: "live.rdap",
  name: "RDAP Domain Registration (live)",
  kind: "domain-intel",
  origin: "LIVE",
  reliability: 0.9,
  timeoutMs: 7000,
  supports: (e) => (e.type === "WEBSITE" || e.type === "DOMAIN") && !net.isIP(e.host ?? ""),
  async collect({ entity, signal }) {
    const domain = entity.registrableDomain!;
    const res = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
      signal,
      headers: { accept: "application/rdap+json" },
    });
    if (res.status === 404) return { status: "NO_DATA", data: null, message: "Domain not found in RDAP (unregistered or unsupported TLD)" };
    if (!res.ok) throw new Error(`RDAP responded ${res.status}`);
    const j = (await res.json()) as RdapDomain;
    const created = j.events?.find((e) => e.eventAction === "registration")?.eventDate ?? null;
    const registrar = j.entities?.find((e) => e.roles?.includes("registrar"));
    const registrant = j.entities?.find((e) => e.roles?.includes("registrant"));
    const registrantOrg = registrant ? vcardValue(registrant, "org") ?? vcardValue(registrant, "fn") : null;
    const allRemarks = JSON.stringify([j.remarks, registrant?.remarks]).toLowerCase();
    const privacy =
      !registrantOrg || /redacted|privacy|proxy|withheld/i.test(registrantOrg) || allRemarks.includes("redacted");
    let hasMx: boolean | null = null;
    try {
      hasMx = (await dns.resolveMx(domain)).length > 0;
    } catch {
      hasMx = false;
    }
    return {
      status: "OK",
      data: {
        domain,
        createdAt: created,
        ageDays: created ? Math.floor((Date.now() - Date.parse(created)) / 86_400_000) : null,
        registrar: registrar ? vcardValue(registrar, "fn") : null,
        registrantOrg: privacy ? null : registrantOrg,
        privacyProtected: privacy,
        nameservers: (j.nameservers ?? []).map((n) => (n.ldhName ?? "").toLowerCase()).filter(Boolean),
        hasMx,
        hostingAsn: null,
        hostingCountry: null,
        popularityRank: null,
      },
    };
  },
};

/* ---------------- HTTP redirect tracer / page inspector ---------------- */

const MAX_HOPS = 6;
const MAX_BYTES = 512 * 1024;

export const httpWebContentProvider: IntelProvider<WebContentData> = {
  id: "live.http",
  name: "HTTP Redirect Tracer & Page Inspector (live)",
  kind: "web-content",
  origin: "LIVE",
  reliability: 0.85,
  timeoutMs: 9000,
  supports: (e) => e.type === "WEBSITE",
  async collect({ entity, brand, signal }) {
    // SSRF-guarded: http(s) only, every hop validated, socket pinned to the
    // validated public address (see net-guard.ts). Blocked destinations throw
    // and surface as a provider ERROR — never as "no risk found".
    const res = await guardedRequest(entity.url!, {
      signal,
      maxHops: MAX_HOPS,
      maxBytes: MAX_BYTES,
      timeoutMs: 8000,
      headers: { "user-agent": "Mozilla/5.0 (compatible; SentinelDRP/1.0; +risk-analysis)", accept: "text/html,*/*" },
      readBody: (ct) => ct.includes("html"),
    });
    const chain = res.chain;
    const html = res.body;
    const refresh = html.match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]*content=["'][^"']*url=([^"'>\s]+)/i);
    const metaRefresh = Boolean(refresh);

    const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
    const lower = text.toLowerCase();
    const title = html.match(/<title[^>]*>([^<]{0,200})<\/title>/i)?.[1]?.trim() ?? null;
    const formActionHosts = [...html.matchAll(/<form[^>]*action=["']([^"']+)["']/gi)]
      .map((m) => {
        try {
          return new URL(m[1], chain[chain.length - 1]).hostname;
        } catch {
          return null;
        }
      })
      .filter((h): h is string => Boolean(h));
    const emails = [...new Set((text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? []).map((e) => e.toLowerCase()))].slice(0, 10);
    const links = [...new Set([...html.matchAll(/href=["'](https?:\/\/[^"']+)["']/gi)].map((m) => m[1]))].slice(0, 25);
    const phrases = Object.values(SCAM_PHRASES)
      .flat()
      .filter((p) => p.length > 4 && lower.includes(p));
    const terms = brand ? brandTerms(brand) : [];
    const brandMentions = terms.reduce((n, t) => n + (lower.replace(/[^a-z0-9]/g, " ").split(t).length - 1), 0);
    const finalUrl = chain[chain.length - 1];
    const regs = new Set(chain.map((c) => splitHost(new URL(c).hostname).registrableDomain));

    return {
      status: "OK",
      data: {
        requestedUrl: entity.url!,
        finalUrl,
        statusCode: res.status,
        redirectChain: chain,
        crossDomainRedirect: regs.size > 1,
        usesTls: finalUrl.startsWith("https://"),
        certIssuer: null,
        certAgeDays: null,
        title,
        hasPasswordField: /<input[^>]+type=["']?password/i.test(html),
        formActionHosts: [...new Set(formActionHosts)],
        brandMentions,
        logoSimilarity: null, // image similarity needs a vision provider; not available in live-free mode
        scamPhrases: [...new Set(phrases)].slice(0, 10),
        contactEmails: emails,
        externalLinks: links,
        metaRefresh,
      },
    };
  },
};
