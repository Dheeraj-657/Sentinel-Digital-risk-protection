import type { BrandReference, IntelProvider, NormalizedEntity } from "../../types";
import type { BrandSimilarityData } from "../contracts";
import { bestBrandMatch, slug, tokens, type BrandMatch } from "../../similarity";
import { SUPPORT_TERMS, SUSPICIOUS_HOST_KEYWORDS } from "../../lexicon";

export function brandTerms(brand: BrandReference): string[] {
  const terms = new Set<string>();
  const add = (s: string) => {
    const v = slug(s);
    if (v.length >= 3) terms.add(v);
  };
  add(brand.name);
  brand.officialDomains.forEach((d) => add(d.split(".")[0]));
  brand.officialHandles.forEach((h) => add(h.replace(/[._-]?(official|hq|app)$/i, "")));
  brand.packagePrefixes.forEach((p) => {
    const segs = p.split(".");
    add(segs[segs.length - 1]);
  });
  return [...terms];
}

export function isOfficialHost(host: string, brand: BrandReference): string | null {
  const h = host.toLowerCase().replace(/^www\./, "");
  return brand.officialDomains.find((d) => h === d || h.endsWith(`.${d}`)) ?? null;
}

function primaryIdentifier(e: NormalizedEntity): string {
  switch (e.type) {
    case "DOMAIN":
    case "WEBSITE": {
      const reg = e.registrableDomain ?? e.host ?? "";
      const tld = e.tld ?? "";
      return tld ? reg.slice(0, -(tld.length + 1)) : reg;
    }
    case "PROFILE":
      return e.handle ?? "";
    case "APP":
      return (e.packageName ?? "").replace(/^(com|org|net|io|app|co|ios)\./, "");
  }
}

/**
 * Lexical brand-similarity analysis (typosquats, homoglyphs, brand-in-subdomain…).
 * Pure computation — real data in every mode. Skipped when no protected brand is given.
 */
export const brandSimilarityProvider: IntelProvider<BrandSimilarityData> = {
  id: "local.brand-similarity",
  name: "Brand Similarity Analyzer",
  kind: "brand-similarity",
  origin: "COMPUTED",
  reliability: 0.9,
  timeoutMs: 1000,
  supports: () => true,
  async collect({ entity, brand }) {
    if (!brand) return { status: "SKIPPED", data: null, message: "No protected brand supplied for comparison" };
    const terms = brandTerms(brand);
    const id = primaryIdentifier(entity);

    let officialAsset: string | null = null;
    if ((entity.type === "DOMAIN" || entity.type === "WEBSITE") && entity.host) {
      officialAsset = isOfficialHost(entity.host, brand);
    } else if (entity.type === "PROFILE" && entity.handle && brand.officialHandles.includes(entity.handle)) {
      officialAsset = `@${entity.handle}`;
    }

    const usesOfficialNamespace =
      entity.type === "APP" &&
      brand.packagePrefixes.some((p) => entity.packageName === p || entity.packageName!.startsWith(`${p}.`));

    const primary: BrandMatch = bestBrandMatch(id, terms);
    let subdomainMatch: BrandMatch | null = null;
    let pathMatch: BrandMatch | null = null;
    if ((entity.type === "WEBSITE" || entity.type === "DOMAIN") && !officialAsset) {
      if (entity.subdomain) {
        const m = bestBrandMatch(entity.subdomain, terms);
        subdomainMatch = m.kind === "NONE" ? null : m;
      }
      if (entity.path && entity.path.length > 1) {
        const pathTokens = tokens(entity.path).join("-");
        const m = bestBrandMatch(pathTokens, terms);
        pathMatch = m.kind === "NONE" || m.kind === "SIMILAR" ? null : m;
      }
    }

    const idTokens = tokens([id, entity.subdomain ?? ""].join("."));
    const pairedKeywords =
      primary.kind !== "NONE" || subdomainMatch
        ? [...new Set(idTokens.filter((t) => SUSPICIOUS_HOST_KEYWORDS.includes(t) || SUPPORT_TERMS.includes(t)))]
        : [];

    return {
      status: "OK",
      data: {
        brandName: brand.name,
        brandTerms: terms,
        isOfficialAsset: Boolean(officialAsset),
        officialAssetMatched: officialAsset,
        primary,
        subdomainMatch,
        pathMatch,
        usesOfficialNamespace,
        pairedKeywords,
      },
    };
  },
};
