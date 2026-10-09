import { z } from "zod";
import { ENTITY_TYPES, type BrandReference, type EntityType, type NormalizedEntity, type SocialPlatform } from "./types";

/* ------------------------------------------------------------------ */
/* Input validation                                                     */
/* ------------------------------------------------------------------ */

const listField = z
  .union([z.array(z.string()), z.string()])
  .optional()
  .transform((v) => {
    const arr = Array.isArray(v) ? v : (v ?? "").split(/[\n,]+/);
    return arr.map((s) => s.trim()).filter(Boolean).slice(0, 20);
  });

export const brandInputSchema = z.object({
  name: z.string().trim().min(2, "Brand name must be at least 2 characters").max(80),
  officialDomains: listField,
  officialHandles: listField,
  appDevelopers: listField,
  packagePrefixes: listField,
  keywords: listField,
});

export const scanRequestSchema = z.object({
  entityType: z.enum(ENTITY_TYPES, { message: "Choose an entity type" }),
  input: z
    .string({ message: "Enter something to analyse" })
    .trim()
    .min(3, "Input is too short")
    .max(2048, "Input is too long"),
  claimedDeveloper: z.string().trim().max(120).optional(),
  brandId: z.string().trim().max(64).optional().nullable(),
  brand: brandInputSchema.optional().nullable(),
});

export type ScanRequest = z.infer<typeof scanRequestSchema>;

export class EntityValidationError extends Error {
  constructor(
    message: string,
    public field: string = "input",
  ) {
    super(message);
    this.name = "EntityValidationError";
  }
}

/* ------------------------------------------------------------------ */
/* Domain helpers                                                       */
/* ------------------------------------------------------------------ */

// Small multi-label public-suffix set (enough for registrable-domain extraction in a demo;
// swap for the `psl`/`tldts` package for full coverage).
const MULTI_LABEL_SUFFIXES = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "org.au", "co.in", "net.in", "org.in",
  "gov.in", "com.br", "com.mx", "co.jp", "co.kr", "com.sg", "com.my", "co.za", "com.tr", "com.cn",
  "com.hk", "co.nz", "com.ar", "com.co", "co.id", "com.ph", "com.vn", "com.pk", "com.ng", "com.eg",
]);

const HOSTNAME_RE = /^(?=.{1,253}$)(?!-)([a-z0-9-]{1,63}(?<!-)\.)+([a-z]{2,63}|xn--[a-z0-9-]{2,59})$/i;
const IPV4_RE = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

export function isIpAddress(host: string): boolean {
  return IPV4_RE.test(host) || host.includes(":");
}

export function splitHost(host: string): { registrableDomain: string; tld: string; subdomain: string } {
  const labels = host.toLowerCase().split(".");
  if (isIpAddress(host) || labels.length < 2) return { registrableDomain: host, tld: "", subdomain: "" };
  const lastTwo = labels.slice(-2).join(".");
  const suffixLen = MULTI_LABEL_SUFFIXES.has(lastTwo) && labels.length >= 3 ? 2 : 1;
  const tld = labels.slice(-suffixLen).join(".");
  const registrableDomain = labels.slice(-(suffixLen + 1)).join(".");
  const subdomain = labels.slice(0, -(suffixLen + 1)).join(".");
  return { registrableDomain, tld, subdomain };
}

/** Converts a unicode hostname to its ASCII (punycode) form using WHATWG URL. */
function toAsciiHost(host: string): string {
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return host.toLowerCase();
  }
}

function parseUrlLike(raw: string): URL {
  let s = raw.trim().replace(/^hxxps?/i, (m) => m.replace(/xx/i, "tt")).replace(/\[\.\]/g, ".");
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `http://${s}`;
  try {
    return new URL(s);
  } catch {
    throw new EntityValidationError("That doesn't look like a valid URL or hostname.");
  }
}

function assertHost(host: string) {
  if (!host) throw new EntityValidationError("No hostname found in the input.");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new EntityValidationError("Local/internal hostnames can't be analysed.");
  }
  if (!isIpAddress(host) && !HOSTNAME_RE.test(host)) {
    throw new EntityValidationError(`"${host}" is not a valid public hostname.`);
  }
}

/* ------------------------------------------------------------------ */
/* Social profile parsing                                               */
/* ------------------------------------------------------------------ */

const PLATFORM_HOSTS: Record<string, SocialPlatform> = {
  "instagram.com": "instagram",
  "x.com": "x",
  "twitter.com": "x",
  "facebook.com": "facebook",
  "fb.com": "facebook",
  "tiktok.com": "tiktok",
  "linkedin.com": "linkedin",
  "youtube.com": "youtube",
  "t.me": "telegram",
  "telegram.me": "telegram",
};

const PLATFORM_ALIASES: Record<string, SocialPlatform> = {
  ig: "instagram", instagram: "instagram", x: "x", twitter: "x", fb: "facebook", facebook: "facebook",
  tiktok: "tiktok", tt: "tiktok", linkedin: "linkedin", li: "linkedin", youtube: "youtube", yt: "youtube",
  telegram: "telegram", tg: "telegram",
};

const PLATFORM_PROFILE_URL: Record<SocialPlatform, (h: string) => string> = {
  instagram: (h) => `https://instagram.com/${h}`,
  x: (h) => `https://x.com/${h}`,
  facebook: (h) => `https://facebook.com/${h}`,
  tiktok: (h) => `https://tiktok.com/@${h}`,
  linkedin: (h) => `https://linkedin.com/in/${h}`,
  youtube: (h) => `https://youtube.com/@${h}`,
  telegram: (h) => `https://t.me/${h}`,
  other: (h) => h,
};

const HANDLE_RE = /^[a-z0-9._-]{2,64}$/i;
const RESERVED_PATHS = new Set(["in", "company", "channel", "c", "user", "profile.php", "pages", "people"]);

function parseProfile(input: string): NormalizedEntity {
  const raw = input.trim();
  let platform: SocialPlatform | undefined;
  let handle: string | undefined;

  const prefixed = raw.match(/^([a-z]+)\s*:\s*@?([^\s/]+)$/i);
  if (prefixed && PLATFORM_ALIASES[prefixed[1].toLowerCase()]) {
    platform = PLATFORM_ALIASES[prefixed[1].toLowerCase()];
    handle = prefixed[2];
  } else if (/^@?[a-z0-9._-]{2,64}$/i.test(raw)) {
    platform = "other";
    handle = raw.replace(/^@/, "");
  } else {
    const url = parseUrlLike(raw);
    const host = url.hostname.replace(/^(www|m|mobile)\./, "");
    platform = PLATFORM_HOSTS[host];
    if (!platform) {
      throw new EntityValidationError(
        "Unrecognised social platform. Use a profile URL from Instagram, X, Facebook, TikTok, LinkedIn, YouTube or Telegram — or platform:handle.",
      );
    }
    const segs = url.pathname.split("/").filter(Boolean);
    const seg = segs.find((s) => !RESERVED_PATHS.has(s.toLowerCase())) ?? url.searchParams.get("id") ?? "";
    handle = seg.replace(/^@/, "");
  }

  if (!handle || !HANDLE_RE.test(handle)) {
    throw new EntityValidationError("Couldn't find a valid account handle in that profile reference.");
  }
  handle = handle.toLowerCase();
  return {
    type: "PROFILE",
    input: raw,
    platform,
    handle,
    profileUrl: PLATFORM_PROFILE_URL[platform](handle),
    target: `${platform}:${handle}`,
    displayName: `@${handle}`,
  };
}

/* ------------------------------------------------------------------ */
/* Website / Domain parsing                                             */
/* ------------------------------------------------------------------ */

function parseWebsite(input: string): NormalizedEntity {
  const url = parseUrlLike(input);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new EntityValidationError("Only http(s) URLs can be analysed.");
  }
  const host = toAsciiHost(url.hostname);
  assertHost(host);
  const parts = splitHost(host);
  const path = `${url.pathname}${url.search}`;
  const explicitScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input.trim());
  return {
    type: "WEBSITE",
    input: input.trim(),
    url: url.toString(),
    host,
    scheme: explicitScheme ? url.protocol.replace(":", "") : undefined,
    path,
    ...parts,
    target: `${host}${url.pathname === "/" ? "" : url.pathname}`.toLowerCase(),
    displayName: host,
  };
}

function parseDomain(input: string): NormalizedEntity {
  const url = parseUrlLike(input);
  const host = toAsciiHost(url.hostname);
  assertHost(host);
  const parts = splitHost(host);
  return {
    type: "DOMAIN",
    input: input.trim(),
    host,
    ...parts,
    target: host,
    displayName: host,
  };
}

/* ------------------------------------------------------------------ */
/* App parsing                                                          */
/* ------------------------------------------------------------------ */

const PACKAGE_RE = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,}$/i;

function parseApp(input: string, claimedDeveloper?: string): NormalizedEntity {
  const raw = input.trim();
  let packageName: string | undefined;
  let storeUrl: string | undefined;
  let appName: string | undefined;

  if (/^https?:\/\//i.test(raw)) {
    const url = parseUrlLike(raw);
    storeUrl = url.toString();
    if (url.hostname.endsWith("play.google.com")) {
      packageName = url.searchParams.get("id") ?? undefined;
    } else if (url.hostname.endsWith("apps.apple.com")) {
      // apps.apple.com/us/app/<slug>/id123456789
      const m = url.pathname.match(/\/app\/([^/]+)\/(id\d+)/);
      if (m) {
        appName = m[1].replace(/-/g, " ");
        packageName = `ios.${m[2]}`;
      }
    } else {
      packageName = url.searchParams.get("id") ?? undefined;
    }
    if (!packageName) throw new EntityValidationError("Couldn't find an app id/package name in that store URL.");
  } else {
    packageName = raw;
  }

  packageName = packageName.toLowerCase();
  if (!packageName.startsWith("ios.") && !PACKAGE_RE.test(packageName)) {
    throw new EntityValidationError("Enter a package name like com.brand.app, or a Play Store / App Store URL.");
  }
  return {
    type: "APP",
    input: raw,
    packageName,
    storeUrl,
    appName,
    claimedDeveloper: claimedDeveloper || undefined,
    target: packageName,
    displayName: appName ?? packageName,
  };
}

/* ------------------------------------------------------------------ */

export function normalizeEntity(type: EntityType, input: string, claimedDeveloper?: string): NormalizedEntity {
  switch (type) {
    case "PROFILE":
      return parseProfile(input);
    case "WEBSITE":
      return parseWebsite(input);
    case "DOMAIN":
      return parseDomain(input);
    case "APP":
      return parseApp(input, claimedDeveloper);
  }
}

export function normalizeBrand(b: {
  id?: string;
  name: string;
  officialDomains?: unknown;
  officialHandles?: unknown;
  appDevelopers?: unknown;
  packagePrefixes?: unknown;
  keywords?: unknown;
}): BrandReference {
  const arr = (v: unknown) =>
    (Array.isArray(v) ? v : [])
      .filter((x): x is string => typeof x === "string")
      .map((s) => s.trim())
      .filter(Boolean);
  return {
    id: b.id,
    name: b.name.trim(),
    officialDomains: arr(b.officialDomains).map((d) => d.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "")),
    officialHandles: arr(b.officialHandles).map((h) => h.toLowerCase().replace(/^@/, "")),
    appDevelopers: arr(b.appDevelopers),
    packagePrefixes: arr(b.packagePrefixes).map((p) => p.toLowerCase()),
    keywords: arr(b.keywords).map((k) => k.toLowerCase()),
  };
}
