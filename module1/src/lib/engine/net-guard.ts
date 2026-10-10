/**
 * SSRF guard for every outbound fetch of an analyst-supplied URL.
 *
 * Three layers, all required:
 *   1. `isNonPublicIp` classifies an address as loopback / private / link-local /
 *      CGNAT / multicast / reserved / cloud-metadata — IPv4, IPv6, IPv4-mapped
 *      and NAT64 forms included.
 *   2. `guardedLookup` is passed to node:http(s) as the socket `lookup` hook, so
 *      the address that is validated is the address that is connected to
 *      (no DNS-rebinding window between "check" and "fetch").
 *   3. `guardedRequest` follows redirects manually, re-validating scheme,
 *      credentials and host on every hop.
 */
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import type { LookupFunction } from "node:net";

export class BlockedDestinationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedDestinationError";
  }
}

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((n, o) => (n << 8) + Number(o), 0) >>> 0;
}

const V4_BLOCKS: [string, number][] = [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // RFC1918
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local incl. 169.254.169.254 metadata
  ["172.16.0.0", 12], // RFC1918
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16], // RFC1918
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
];

function isNonPublicV4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  return V4_BLOCKS.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) >>> 0 === (ipv4ToInt(base) & mask) >>> 0;
  });
}

/** Expands an IPv6 address (any textual form, incl. embedded IPv4) to 8 hextets. */
function expandV6(ip: string): number[] | null {
  let s = ip.toLowerCase().split("%")[0];
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    if (!net.isIPv4(v4[1])) return null;
    const n = ipv4ToInt(v4[1]);
    s = s.slice(0, -v4[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  const parts = [...head, ...Array(Math.max(0, fill)).fill("0"), ...tail].map((h) => parseInt(h, 16));
  return parts.length === 8 && parts.every((p) => Number.isInteger(p) && p >= 0 && p <= 0xffff) ? parts : null;
}

/** True for any address an analyst-supplied URL must never reach. Unknown forms count as non-public. */
export function isNonPublicIp(raw: string): boolean {
  const ip = raw.replace(/^\[|\]$/g, "");
  if (net.isIPv4(ip)) return isNonPublicV4(ip);
  if (!net.isIPv6(ip)) return true;
  const h = expandV6(ip);
  if (!h) return true;
  const v4 = `${h[6] >> 8}.${h[6] & 0xff}.${h[7] >> 8}.${h[7] & 0xff}`;
  const zeroPrefix = (n: number) => h.slice(0, n).every((x) => x === 0);
  if (zeroPrefix(8)) return true; // ::
  if (zeroPrefix(7) && h[7] === 1) return true; // ::1
  if (zeroPrefix(5) && h[5] === 0xffff) return isNonPublicV4(v4); // ::ffff:a.b.c.d (IPv4-mapped)
  if (zeroPrefix(6)) return true; // ::a.b.c.d (deprecated IPv4-compatible)
  if (h[0] === 0x64 && h[1] === 0xff9b && h.slice(2, 6).every((x) => x === 0)) return isNonPublicV4(v4); // NAT64
  if (h[0] === 0x2002) return isNonPublicV4(`${h[1] >> 8}.${h[1] & 0xff}.${h[2] >> 8}.${h[2] & 0xff}`); // 6to4
  if ((h[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((h[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((h[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((h[0] & 0xff00) === 0xff00) return true; // multicast
  if (h[0] === 0x2001 && h[1] === 0x0db8) return true; // documentation
  if (h[0] === 0x2001 && h[1] < 0x0200) return true; // 2001::/23 IETF protocol assignments (Teredo etc.)
  if (h[0] === 0x0100 && h.slice(1, 4).every((x) => x === 0)) return true; // discard-only
  return false;
}

/** Hostnames that must never be fetched regardless of what DNS says. */
export function isBlockedHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    h.endsWith(".lan") ||
    h.endsWith(".home.arpa") ||
    h === "metadata" ||
    h === "metadata.google.internal"
  );
}

type Resolver = (host: string) => Promise<{ address: string; family: number }[]>;
const systemResolver: Resolver = (host) => dns.promises.lookup(host, { all: true, verbatim: true });

/**
 * A `net.LookupFunction` that resolves, rejects the whole answer if ANY address is
 * non-public, then hands the validated addresses to the socket. Because the socket
 * connects to exactly what this returns, a rebinding DNS server cannot swap in a
 * private address after the check.
 */
export function makeGuardedLookup(resolve: Resolver = systemResolver, blocked: (ip: string) => boolean = isNonPublicIp): LookupFunction {
  return ((hostname: string, options: dns.LookupOptions, callback: (...args: unknown[]) => void) => {
    const cb = typeof options === "function" ? (options as typeof callback) : callback;
    const opts = typeof options === "object" && options ? options : {};
    if (isBlockedHostname(hostname)) {
      cb(new BlockedDestinationError(`Refusing to fetch internal hostname ${hostname}`));
      return;
    }
    resolve(hostname)
      .then((addrs) => {
        if (!addrs.length) throw new Error(`Could not resolve ${hostname}`);
        const bad = addrs.find((a) => blocked(a.address));
        if (bad) throw new BlockedDestinationError(`Refusing to fetch ${hostname}: resolves to non-public address`);
        if (opts.all) cb(null, addrs);
        else cb(null, addrs[0].address, addrs[0].family);
      })
      .catch((err) => cb(err));
  }) as LookupFunction;
}

/** Validates one hop's URL before any socket is opened. Returns the parsed URL. */
export function assertFetchableUrl(raw: string, blocked: (ip: string) => boolean = isNonPublicIp): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new BlockedDestinationError("Invalid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new BlockedDestinationError(`Refusing non-http(s) URL scheme ${u.protocol}`);
  }
  if (u.username || u.password) throw new BlockedDestinationError("Refusing URL with embedded credentials");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!host) throw new BlockedDestinationError("URL has no host");
  if (isBlockedHostname(host)) throw new BlockedDestinationError(`Refusing to fetch internal hostname ${host}`);
  if (net.isIP(host) && blocked(host)) throw new BlockedDestinationError(`Refusing to fetch non-public address ${host}`);
  return u;
}

export interface GuardedResponse {
  status: number;
  headers: Record<string, string>;
  finalUrl: string;
  chain: string[];
  body: string;
}

export interface GuardedRequestOptions {
  signal?: AbortSignal;
  maxHops?: number;
  maxBytes?: number;
  timeoutMs?: number;
  headers?: Record<string, string>;
  /** Read the body only if this returns true for the content-type. */
  readBody?: (contentType: string) => boolean;
  /** Test seam: replace DNS resolution. */
  resolver?: Resolver;
  /** Test seam: address policy (defaults to `isNonPublicIp`). Never set in production code. */
  isBlockedIp?: (ip: string) => boolean;
}

function oneHop(
  u: URL,
  opts: GuardedRequestOptions,
  lookup: LookupFunction,
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  const maxBytes = opts.maxBytes ?? 512 * 1024;
  return new Promise((resolve, reject) => {
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.request(
      u,
      {
        method: "GET",
        headers: opts.headers,
        lookup,
        signal: opts.signal,
        timeout: opts.timeoutMs ?? 8000,
        // No connection reuse: each hop resolves and validates afresh.
        agent: false,
      },
      (res) => {
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) headers[k] = Array.isArray(v) ? v.join(", ") : v;
        const status = res.statusCode ?? 0;
        const isRedirect = status >= 300 && status < 400 && !!headers.location;
        if (isRedirect || !(opts.readBody?.(headers["content-type"] ?? "") ?? true)) {
          res.destroy();
          resolve({ status, headers, body: "" });
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (c: Buffer) => {
          chunks.push(c);
          total += c.length;
          if (total >= maxBytes) res.destroy();
        });
        const done = () => resolve({ status, headers, body: Buffer.concat(chunks).subarray(0, maxBytes).toString("utf8") });
        res.on("end", done);
        res.on("close", done);
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("Request timed out")));
    req.on("error", reject);
    req.end();
  });
}

/**
 * GET with manual redirect following. Every hop: http(s) only, no credentials,
 * hostname/IP literal checked, and the socket connects through `guardedLookup`.
 */
export async function guardedRequest(startUrl: string, opts: GuardedRequestOptions = {}): Promise<GuardedResponse> {
  const blocked = opts.isBlockedIp ?? isNonPublicIp;
  const lookup = makeGuardedLookup(opts.resolver, blocked);
  const chain: string[] = [];
  let url = startUrl;
  const maxHops = opts.maxHops ?? 6;
  for (let hop = 0; hop < maxHops; hop++) {
    const u = assertFetchableUrl(url, blocked);
    chain.push(u.toString());
    const res = await oneHop(u, opts, lookup);
    const loc = res.headers.location;
    if (res.status >= 300 && res.status < 400 && loc) {
      url = new URL(loc, u).toString();
      continue;
    }
    return { ...res, finalUrl: u.toString(), chain };
  }
  throw new BlockedDestinationError(`Too many redirects (>${maxHops})`);
}
