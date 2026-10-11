import type { BrandReference, NormalizedEntity, ProviderResult, RiskCategory, ScoreAdjustment, Severity, Signal } from "../types";
import type {
  AppIntelData,
  BrandSimilarityData,
  DomainIntelData,
  ReputationData,
  SocialProfileData,
  UrlAnalysisData,
  WebContentData,
} from "../providers/contracts";
import { dataOf } from "../providers/registry";
import { slug } from "../similarity";
import { brandTerms } from "../providers/local/brand-similarity";

export type SignalDraft = Omit<Signal, "id">;

interface Sourced<T> {
  data: T;
  result: ProviderResult;
}

export interface RuleContext {
  entity: NormalizedEntity;
  brand: BrandReference | null;
  brandTerms: string[];
  results: ProviderResult[];
  url: Sourced<UrlAnalysisData> | null;
  brandSim: Sourced<BrandSimilarityData> | null;
  domain: Sourced<DomainIntelData> | null;
  rep: Sourced<ReputationData> | null;
  web: Sourced<WebContentData> | null;
  social: Sourced<SocialProfileData> | null;
  app: Sourced<AppIntelData> | null;
  /** The entity is a verified official asset of the protected brand. */
  isOfficial: boolean;
  /** The entity presents itself as the brand (name, identifier or logo). */
  claimsBrand: boolean;
}

export interface RuleOutput {
  signals: SignalDraft[];
  adjustments: ScoreAdjustment[];
}

export type Rule = (ctx: RuleContext, out: RuleOutput) => void;

/** Builds a signal using provenance from the provider result that supplied the evidence. */
export function sig(
  source: { result: ProviderResult },
  s: { ruleId: string; category: RiskCategory; severity: Severity; impact: number; title: string; description: string; evidence: string },
): SignalDraft {
  return {
    ...s,
    provider: source.result.providerName,
    origin: source.result.origin,
    reliability: source.result.reliability,
  };
}

export function textMentionsBrand(text: string | null | undefined, terms: string[]): boolean {
  if (!text || !terms.length) return false;
  const t = slug(text);
  return terms.some((term) => term.length >= 3 && t.includes(term));
}

export function buildContext(entity: NormalizedEntity, brand: BrandReference | null, results: ProviderResult[]): RuleContext {
  const terms = brand ? brandTerms(brand) : [];
  const ctx: RuleContext = {
    entity,
    brand,
    brandTerms: terms,
    results,
    url: dataOf(results, "url-analysis"),
    brandSim: dataOf(results, "brand-similarity"),
    domain: dataOf(results, "domain-intel"),
    rep: dataOf(results, "reputation"),
    web: dataOf(results, "web-content"),
    social: dataOf(results, "social-intel"),
    app: dataOf(results, "app-intel"),
    isOfficial: false,
    claimsBrand: false,
  };

  const bs = ctx.brandSim?.data;
  if (brand && bs) {
    if (entity.type === "APP") {
      const dev = ctx.app?.data.developerName ?? "";
      const devOk = brand.appDevelopers.some((d) => slug(d) === slug(dev));
      ctx.isOfficial = bs.usesOfficialNamespace && devOk && Boolean(ctx.app?.data.officialStore);
    } else {
      ctx.isOfficial = bs.isOfficialAsset;
    }
    const logo = Math.max(
      ctx.web?.data.logoSimilarity ?? 0,
      ctx.social?.data.avatarLogoSimilarity ?? 0,
      ctx.app?.data.iconSimilarity ?? 0,
    );
    ctx.claimsBrand =
      bs.primary.kind !== "NONE" ||
      Boolean(bs.subdomainMatch) ||
      bs.usesOfficialNamespace ||
      textMentionsBrand(ctx.social?.data.displayName, terms) ||
      textMentionsBrand(ctx.web?.data.title, terms) ||
      textMentionsBrand(ctx.app?.data.appName, terms) ||
      logo >= 0.85;
  }
  return ctx;
}
