/**
 * Per-client token bucket (in-process). Protects the scan endpoint and, indirectly,
 * Groq and any external providers. Replace the Map with Redis for multi-instance deploys.
 */
type Bucket = { tokens: number; updated: number };
const g = globalThis as unknown as { __buckets?: Map<string, Bucket> };
const buckets = (g.__buckets ??= new Map());

export function rateLimit(key: string, perMinute = Number(process.env.SCAN_RATE_LIMIT_PER_MINUTE) || 12) {
  const now = Date.now();
  const refillPerMs = perMinute / 60_000;
  const b = buckets.get(key) ?? { tokens: perMinute, updated: now };
  b.tokens = Math.min(perMinute, b.tokens + (now - b.updated) * refillPerMs);
  b.updated = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    return { ok: false as const, retryAfterSec: Math.ceil((1 - b.tokens) / refillPerMs / 1000) };
  }
  b.tokens -= 1;
  buckets.set(key, b);
  if (buckets.size > 5000) buckets.delete(buckets.keys().next().value!);
  return { ok: true as const, remaining: Math.floor(b.tokens) };
}

export function clientKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || req.headers.get("x-real-ip") || "local";
}
