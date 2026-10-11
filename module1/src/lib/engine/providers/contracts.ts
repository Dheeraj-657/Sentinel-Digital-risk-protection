/**
 * Data contracts for each provider kind.
 *
 * A real API adapter (VirusTotal, WhoisXML, Safe Browsing, a social-data vendor,
 * an app-store scraper…) only has to map its response onto one of these shapes.
 * The rule layer consumes these shapes and never knows which vendor produced them.
 */

import type { BrandMatch } from "../similarity";

/** url-analysis — always computed locally from the input. */
export interface UrlAnalysisData {
  host: string;
  registrableDomain: string;
  tld: string;
  subdomain: string;
  subdomainDepth: number;
  hyphenCount: number;
  digitCount: number;
  hostLength: number;
  isIpHost: boolean;
  isPunycode: boolean;
  unicodeHost: string | null;
  usesHttps: boolean | null; // null = scheme not specified
  hasAtSymbol: boolean;
  nonStandardPort: string | null;
  suspiciousHostKeywords: string[];
  suspiciousPathKeywords: string[];
  riskyTld: boolean;
  freeHostingProvider: string | null;
  urlShortener: boolean;
}

/** brand-similarity — always computed locally against the protected brand. */
export interface BrandSimilarityData {
  brandName: string;
  brandTerms: string[];
  /** The entity is (or is under) an official brand asset. */
  isOfficialAsset: boolean;
  officialAssetMatched: string | null;
  primary: BrandMatch; // main identifier (domain label / handle / package)
  subdomainMatch: BrandMatch | null;
  pathMatch: BrandMatch | null;
  /** Package name sits inside the brand's official namespace (e.g. com.brand.*). */
  usesOfficialNamespace: boolean;
  /** Free-text claims that the identifier pairs with the brand (support, login…). */
  pairedKeywords: string[];
}

/** domain-intel — WHOIS/RDAP-style registration data. */
export interface DomainIntelData {
  domain: string;
  createdAt: string | null; // ISO
  ageDays: number | null;
  registrar: string | null;
  registrantOrg: string | null;
  privacyProtected: boolean | null;
  nameservers: string[];
  hasMx: boolean | null;
  hostingAsn: string | null;
  hostingCountry: string | null;
  popularityRank: number | null; // e.g. Tranco rank, lower = more popular
}

/** reputation — threat feeds / blocklists / community reports. */
export interface ReputationData {
  subject: string;
  listings: {
    feed: string;
    verdict: "MALICIOUS" | "SUSPICIOUS" | "CLEAN";
    category: string; // phishing, malware, scam, impersonation…
    firstSeen: string | null; // ISO
  }[];
  communityReports: number;
  lastReportedAt: string | null;
}

/** web-content — fetched page characteristics. */
export interface WebContentData {
  requestedUrl: string;
  finalUrl: string;
  statusCode: number | null;
  redirectChain: string[]; // every hop including final
  crossDomainRedirect: boolean;
  usesTls: boolean;
  certIssuer: string | null;
  certAgeDays: number | null;
  title: string | null;
  hasPasswordField: boolean;
  formActionHosts: string[];
  brandMentions: number;
  logoSimilarity: number | null; // 0–1 perceptual similarity to brand logo
  scamPhrases: string[];
  contactEmails: string[];
  externalLinks: string[];
  metaRefresh: boolean;
}

/** social-intel — profile metadata. */
export interface SocialProfileData {
  platform: string;
  handle: string;
  displayName: string;
  bio: string;
  platformVerified: boolean;
  followers: number;
  following: number;
  posts: number;
  accountAgeDays: number | null;
  avatarLogoSimilarity: number | null; // 0–1
  externalLinks: string[];
  contactEmails: string[];
  recentPostThemes: string[];
  postsLast7Days: number | null;
}

/** app-intel — store listing metadata. */
export interface AppIntelData {
  packageName: string;
  appName: string;
  developerName: string;
  developerEmail: string | null;
  developerWebsite: string | null;
  store: string; // "Google Play", "App Store", "Third-party APK site"…
  officialStore: boolean;
  installs: number | null;
  rating: number | null;
  ratingCount: number | null;
  publishedDaysAgo: number | null;
  permissions: string[];
  iconSimilarity: number | null; // 0–1 vs brand logo
  description: string;
}

export interface ProviderDataByKind {
  "url-analysis": UrlAnalysisData;
  "brand-similarity": BrandSimilarityData;
  "domain-intel": DomainIntelData;
  reputation: ReputationData;
  "web-content": WebContentData;
  "social-intel": SocialProfileData;
  "app-intel": AppIntelData;
}
