/**
 * Curated DEMO threat-intelligence dataset.
 *
 * Used by the mock providers in INTEL_MODE=demo so the full feature works without paid APIs.
 * Brands and records are fictional (hosting ASNs use the private 64512–65534 range).
 * Every signal derived from these records is tagged origin=DEMO and labelled in the UI.
 *
 * Unknown entities get NO_DATA from the mock providers (lowering confidence) — the
 * dataset never fabricates evidence for inputs it doesn't know.
 */

import type { EntityType } from "@/lib/engine/types";

export interface DemoBrand {
  name: string;
  officialDomains: string[];
  officialHandles: string[];
  appDevelopers: string[];
  packagePrefixes: string[];
  keywords: string[];
}

export const DEMO_BRANDS: DemoBrand[] = [
  {
    name: "NovaPay",
    officialDomains: ["novapay.com", "novapay.app"],
    officialHandles: ["novapay", "novapaysupport"],
    appDevelopers: ["NovaPay Inc."],
    packagePrefixes: ["com.novapay"],
    keywords: ["novapay", "nova pay", "novawallet"],
  },
  {
    name: "ShopVerse",
    officialDomains: ["shopverse.com"],
    officialHandles: ["shopverse"],
    appDevelopers: ["ShopVerse Technologies Ltd"],
    packagePrefixes: ["com.shopverse"],
    keywords: ["shopverse", "shop verse"],
  },
];

/* ---------------- domain intel (keyed by registrable domain) ---------------- */
export interface DemoDomainRecord {
  createdDaysAgo: number;
  registrar: string;
  registrantOrg: string | null;
  privacyProtected: boolean;
  nameservers: string[];
  hasMx: boolean;
  hostingAsn: string;
  hostingCountry: string;
  popularityRank: number | null;
}

export const DEMO_DOMAINS: Record<string, DemoDomainRecord> = {
  "novapay.com": {
    createdDaysAgo: 5320,
    registrar: "Corporate Domains Registrar Inc. (demo)",
    registrantOrg: "NovaPay Inc.",
    privacyProtected: false,
    nameservers: ["ns1.novapay.com", "ns2.novapay.com"],
    hasMx: true,
    hostingAsn: "AS64600 NovaPay Edge Network",
    hostingCountry: "US",
    popularityRank: 2140,
  },
  "n0vapay-support.com": {
    createdDaysAgo: 6,
    registrar: "BudgetNames LLC (demo)",
    registrantOrg: null,
    privacyProtected: true,
    nameservers: ["ns1.freedns-parking.example", "ns2.freedns-parking.example"],
    hasMx: true,
    hostingAsn: "AS64999 FastVPS Offshore (demo)",
    hostingCountry: "NL",
    popularityRank: null,
  },
  "verify-account.top": {
    createdDaysAgo: 3,
    registrar: "CheapTLD Registry Pte. (demo)",
    registrantOrg: null,
    privacyProtected: true,
    nameservers: ["ns1.bulletproof-dns.example", "ns2.bulletproof-dns.example"],
    hasMx: false,
    hostingAsn: "AS65010 Anonymous Hosting Ltd (demo)",
    hostingCountry: "SC",
    popularityRank: null,
  },
  "shopverse.com": {
    createdDaysAgo: 3900,
    registrar: "Corporate Domains Registrar Inc. (demo)",
    registrantOrg: "ShopVerse Technologies Ltd",
    privacyProtected: false,
    nameservers: ["ns1.shopverse.com", "ns2.shopverse.com"],
    hasMx: true,
    hostingAsn: "AS64610 ShopVerse Cloud",
    hostingCountry: "GB",
    popularityRank: 5870,
  },
  "shopverse-outlet-sale.shop": {
    createdDaysAgo: 21,
    registrar: "BudgetNames LLC (demo)",
    registrantOrg: null,
    privacyProtected: true,
    nameservers: ["ns1.freedns-parking.example", "ns2.freedns-parking.example"],
    hasMx: false,
    hostingAsn: "AS64999 FastVPS Offshore (demo)",
    hostingCountry: "NL",
    popularityRank: null,
  },
};

/* ---------------- reputation (keyed by host, registrable domain, platform:handle, or package) ---------------- */
export interface DemoReputationRecord {
  listings: { feed: string; verdict: "MALICIOUS" | "SUSPICIOUS" | "CLEAN"; category: string; firstSeenDaysAgo: number | null }[];
  communityReports: number;
  lastReportedDaysAgo: number | null;
}

export const DEMO_REPUTATION: Record<string, DemoReputationRecord> = {
  "novapay.com": {
    listings: [{ feed: "Demo Reputation DB", verdict: "CLEAN", category: "established brand domain", firstSeenDaysAgo: 5000 }],
    communityReports: 0,
    lastReportedDaysAgo: null,
  },
  "n0vapay-support.com": {
    listings: [{ feed: "Demo PhishFeed", verdict: "MALICIOUS", category: "phishing", firstSeenDaysAgo: 2 }],
    communityReports: 14,
    lastReportedDaysAgo: 1,
  },
  "verify-account.top": {
    listings: [
      { feed: "Demo PhishFeed", verdict: "MALICIOUS", category: "phishing", firstSeenDaysAgo: 1 },
      { feed: "Demo URL Blocklist", verdict: "MALICIOUS", category: "credential theft", firstSeenDaysAgo: 1 },
    ],
    communityReports: 31,
    lastReportedDaysAgo: 0,
  },
  "shopverse-outlet-sale.shop": {
    listings: [],
    communityReports: 2,
    lastReportedDaysAgo: 5,
  },
  "instagram:novapay.support.help": {
    listings: [{ feed: "Demo Social Abuse Feed", verdict: "SUSPICIOUS", category: "impersonation", firstSeenDaysAgo: 4 }],
    communityReports: 9,
    lastReportedDaysAgo: 1,
  },
  "telegram:novapay_airdrop": {
    listings: [{ feed: "Demo Crypto Scam Tracker", verdict: "MALICIOUS", category: "advance-fee crypto scam", firstSeenDaysAgo: 2 }],
    communityReports: 22,
    lastReportedDaysAgo: 0,
  },
  "x:novapay": { listings: [], communityReports: 0, lastReportedDaysAgo: null },
  "facebook:shopverse.giveaways": { listings: [], communityReports: 6, lastReportedDaysAgo: 3 },
  "com.novapay.wallet": {
    listings: [{ feed: "Demo Mobile Threat Feed", verdict: "CLEAN", category: "verified publisher", firstSeenDaysAgo: 3000 }],
    communityReports: 0,
    lastReportedDaysAgo: null,
  },
  "com.novapay.wallet.secure": {
    listings: [{ feed: "Demo Mobile Threat Feed", verdict: "SUSPICIOUS", category: "banking-trojan heuristics", firstSeenDaysAgo: 3 }],
    communityReports: 3,
    lastReportedDaysAgo: 2,
  },
};

/* ---------------- web content (keyed by host+path, then host) ---------------- */
export interface DemoWebRecord {
  redirectChain: string[];
  statusCode: number;
  usesTls: boolean;
  certIssuer: string | null;
  certAgeDays: number | null;
  title: string;
  hasPasswordField: boolean;
  formActionHosts: string[];
  brandMentions: number;
  logoSimilarity: number | null;
  scamPhrases: string[];
  contactEmails: string[];
  externalLinks: string[];
  metaRefresh: boolean;
}

export const DEMO_WEB: Record<string, DemoWebRecord> = {
  "secure-novapay.verify-account.top/login": {
    redirectChain: [
      "https://secure-novapay.verify-account.top/login",
      "https://trk.click-gate.xyz/r?c=nvp7741",
      "https://secure-novapay.verify-account.top/signin/session",
    ],
    statusCode: 200,
    usesTls: true,
    certIssuer: "Free DV CA (demo)",
    certAgeDays: 2,
    title: "NovaPay | Log in to your account",
    hasPasswordField: true,
    formActionHosts: ["collect.nvp-gate.xyz"],
    brandMentions: 17,
    logoSimilarity: 0.96,
    scamPhrases: ["verify your account", "account has been suspended", "within 24 hours"],
    contactEmails: ["support@n0vapay-support.com"],
    externalLinks: ["https://n0vapay-support.com/help"],
    metaRefresh: false,
  },
  "novapay-rewards.netlify.app/claim": {
    redirectChain: ["https://novapay-rewards.netlify.app/claim"],
    statusCode: 200,
    usesTls: true,
    certIssuer: "Hosting platform wildcard certificate (demo)",
    certAgeDays: 120,
    title: "NovaPay 10th Anniversary Rewards 🎁",
    hasPasswordField: false,
    formActionHosts: ["formsink.example"],
    brandMentions: 9,
    logoSimilarity: 0.88,
    scamPhrases: ["claim your reward", "limited time", "first 100", "gift card"],
    contactEmails: ["novapay.rewards.team@gmail.com"],
    externalLinks: ["https://t.me/novapay_airdrop"],
    metaRefresh: false,
  },
  "novapay.com": {
    redirectChain: ["https://novapay.com/", "https://www.novapay.com/"],
    statusCode: 200,
    usesTls: true,
    certIssuer: "Enterprise EV CA (demo)",
    certAgeDays: 210,
    title: "NovaPay — Pay, send and get paid",
    hasPasswordField: true,
    formActionHosts: ["novapay.com"],
    brandMentions: 40,
    logoSimilarity: 1,
    scamPhrases: [],
    contactEmails: ["help@novapay.com"],
    externalLinks: [],
    metaRefresh: false,
  },
};

/* ---------------- social profiles (keyed by platform:handle) ---------------- */
export interface DemoSocialRecord {
  displayName: string;
  bio: string;
  platformVerified: boolean;
  followers: number;
  following: number;
  posts: number;
  accountAgeDays: number;
  avatarLogoSimilarity: number | null;
  externalLinks: string[];
  contactEmails: string[];
  recentPostThemes: string[];
  postsLast7Days: number;
}

export const DEMO_SOCIAL: Record<string, DemoSocialRecord> = {
  "instagram:novapay.support.help": {
    displayName: "NovaPay Support ✔",
    bio: "Official NovaPay Help Desk 🔒 Account locked? DM us your registered email & account number for instant recovery. WhatsApp +1 555-0132",
    platformVerified: false,
    followers: 312,
    following: 2870,
    posts: 41,
    accountAgeDays: 12,
    avatarLogoSimilarity: 0.94,
    externalLinks: ["https://n0vapay-support.com/recover"],
    contactEmails: ["novapay.helpdesk@gmail.com"],
    recentPostThemes: ["account recovery", "refund offers"],
    postsLast7Days: 29,
  },
  "x:novapay": {
    displayName: "NovaPay",
    bio: "Pay, send and get paid. Help: @novapaysupport. We will never ask for your password or one-time code.",
    platformVerified: true,
    followers: 1240000,
    following: 312,
    posts: 18400,
    accountAgeDays: 4380,
    avatarLogoSimilarity: 1,
    externalLinks: ["https://novapay.com"],
    contactEmails: [],
    recentPostThemes: ["product updates", "security tips"],
    postsLast7Days: 9,
  },
  "telegram:novapay_airdrop": {
    displayName: "NovaPay Official Airdrop 🚀",
    bio: "Celebrating 1M users! Send 0.1 ETH to the event wallet and get 0.3 ETH back. Limited time — first 100 only. Claim now!",
    platformVerified: false,
    followers: 5400,
    following: 0,
    posts: 63,
    accountAgeDays: 4,
    avatarLogoSimilarity: 0.91,
    externalLinks: ["https://novapay-rewards.netlify.app/claim"],
    contactEmails: [],
    recentPostThemes: ["crypto giveaway", "airdrop"],
    postsLast7Days: 63,
  },
  "facebook:shopverse.giveaways": {
    displayName: "ShopVerse Giveaways",
    bio: "🎉 Win a $500 ShopVerse gift card! Like, share and claim your reward at the link below. Winners announced daily.",
    platformVerified: false,
    followers: 2100,
    following: 4,
    posts: 18,
    accountAgeDays: 33,
    avatarLogoSimilarity: 0.82,
    externalLinks: ["https://shopverse-outlet-sale.shop/claim"],
    contactEmails: [],
    recentPostThemes: ["giveaway", "gift cards"],
    postsLast7Days: 6,
  },
};

/* ---------------- apps (keyed by package name) ---------------- */
export interface DemoAppRecord {
  appName: string;
  developerName: string;
  developerEmail: string | null;
  developerWebsite: string | null;
  store: string;
  officialStore: boolean;
  installs: number;
  rating: number | null;
  ratingCount: number;
  publishedDaysAgo: number;
  permissions: string[];
  iconSimilarity: number | null;
  description: string;
}

export const DEMO_APPS: Record<string, DemoAppRecord> = {
  "com.novapay.wallet": {
    appName: "NovaPay: Send & Pay",
    developerName: "NovaPay Inc.",
    developerEmail: "mobile@novapay.com",
    developerWebsite: "https://novapay.com",
    store: "Google Play",
    officialStore: true,
    installs: 10000000,
    rating: 4.6,
    ratingCount: 382000,
    publishedDaysAgo: 3200,
    permissions: ["android.permission.INTERNET", "android.permission.CAMERA", "android.permission.USE_BIOMETRIC"],
    iconSimilarity: 1,
    description: "Send money, pay in stores and manage your NovaPay balance securely.",
  },
  "com.novapay.wallet.secure": {
    appName: "NovaPay Secure Wallet",
    developerName: "NP Secure Labs",
    developerEmail: "npsecurelabs@gmail.com",
    developerWebsite: "https://n0vapay-support.com",
    store: "Third-party APK site",
    officialStore: false,
    installs: 500,
    rating: 2.1,
    ratingCount: 11,
    publishedDaysAgo: 9,
    permissions: [
      "android.permission.INTERNET",
      "android.permission.READ_SMS",
      "android.permission.RECEIVE_SMS",
      "android.permission.BIND_ACCESSIBILITY_SERVICE",
      "android.permission.SYSTEM_ALERT_WINDOW",
      "android.permission.QUERY_ALL_PACKAGES",
    ],
    iconSimilarity: 0.93,
    description: "Official NovaPay security update. Verify your account to keep your wallet active. Urgent: install within 24 hours.",
  },
};

/* ---------------- sample entities for the scanner ---------------- */
export interface DemoEntity {
  label: string;
  entityType: EntityType;
  input: string;
  brand: string | null;
  claimedDeveloper?: string;
  scenario: string;
}

export const DEMO_ENTITIES: DemoEntity[] = [
  {
    label: "Credential-phishing page",
    entityType: "WEBSITE",
    input: "https://secure-novapay.verify-account.top/login",
    brand: "NovaPay",
    scenario: "Brand in subdomain, risky TLD, password form, redirect hop, threat-feed hit",
  },
  {
    label: "Homoglyph support domain",
    entityType: "DOMAIN",
    input: "n0vapay-support.com",
    brand: "NovaPay",
    scenario: "'0' for 'o' typosquat registered 6 days ago",
  },
  {
    label: "Fake support account",
    entityType: "PROFILE",
    input: "https://instagram.com/novapay.support.help",
    brand: "NovaPay",
    scenario: "Copied logo, fake ✔, asks for account numbers in DMs",
  },
  {
    label: "Crypto airdrop scam",
    entityType: "PROFILE",
    input: "telegram:novapay_airdrop",
    brand: "NovaPay",
    scenario: "'Send 0.1 ETH, get 0.3 back' giveaway channel",
  },
  {
    label: "Malicious clone app",
    entityType: "APP",
    input: "com.novapay.wallet.secure",
    brand: "NovaPay",
    scenario: "Developer mismatch, SMS + accessibility permissions, sideloaded",
  },
  {
    label: "Reward scam on free hosting",
    entityType: "WEBSITE",
    input: "https://novapay-rewards.netlify.app/claim",
    brand: "NovaPay",
    scenario: "Giveaway language, gmail contact, free hosting",
  },
  {
    label: "Giveaway page",
    entityType: "PROFILE",
    input: "facebook:shopverse.giveaways",
    brand: "ShopVerse",
    scenario: "Gift-card giveaway linking to a look-alike shop",
  },
  {
    label: "Look-alike outlet store",
    entityType: "DOMAIN",
    input: "shopverse-outlet-sale.shop",
    brand: "ShopVerse",
    scenario: "Brand + 'sale' on a cheap TLD, 3 weeks old",
  },
  {
    label: "Official domain (control)",
    entityType: "DOMAIN",
    input: "novapay.com",
    brand: "NovaPay",
    scenario: "Legitimate asset; should score very low",
  },
  {
    label: "Official X account (control)",
    entityType: "PROFILE",
    input: "x:novapay",
    brand: "NovaPay",
    scenario: "Verified official account",
  },
  {
    label: "Official app (control)",
    entityType: "APP",
    input: "com.novapay.wallet",
    brand: "NovaPay",
    scenario: "Genuine app from the official developer",
  },
  {
    label: "Unknown domain, no brand",
    entityType: "DOMAIN",
    input: "parcel-redelivery-fee.info",
    brand: null,
    scenario: "No intel records, so only lexical analysis runs and confidence drops",
  },
];
