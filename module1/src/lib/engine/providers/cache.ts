/**
 * Tiny in-process TTL cache for provider results — avoids hammering external APIs
 * when the same entity is re-scanned. Swap for Redis when running multiple instances.
 */
import { PROVIDER_CACHE_TTL_MS } from "../constants";

type Entry = { value: unknown; expires: number };
const g = globalThis as unknown as { __providerCache?: Map<string, Entry> };
const store = (g.__providerCache ??= new Map());
const MAX_ENTRIES = 500;

export function cacheGet<T>(key: string): T | null {
  const e = store.get(key);
  if (!e) return null;
  if (e.expires < Date.now()) {
    store.delete(key);
    return null;
  }
  return e.value as T;
}

export function cacheSet(key: string, value: unknown, ttlMs = PROVIDER_CACHE_TTL_MS) {
  if (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  store.set(key, { value, expires: Date.now() + ttlMs });
}
