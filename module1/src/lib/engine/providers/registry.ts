/**
 * Provider registry & runner.
 *
 * Adding a provider = implement IntelProvider<T> and add it to the list for the right mode.
 * The risk engine itself never changes.
 */
import type { IntelMode, IntelProvider, NormalizedEntity, BrandReference, ProviderResult, ProviderKind } from "../types";
import type { ProviderDataByKind } from "./contracts";
import { urlAnalysisProvider } from "./local/url-analysis";
import { brandSimilarityProvider } from "./local/brand-similarity";
import {
  demoAppProvider,
  demoDomainIntelProvider,
  demoReputationProvider,
  demoSocialProvider,
  demoWebContentProvider,
} from "./mock/demo-providers";
import { httpWebContentProvider, rdapDomainProvider } from "./live/live-providers";
import { cacheGet, cacheSet } from "./cache";

export function getIntelMode(): IntelMode {
  return process.env.INTEL_MODE === "live" ? "live" : "demo";
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyProvider = IntelProvider<any>;

const LOCAL: AnyProvider[] = [urlAnalysisProvider, brandSimilarityProvider];

/**
 * Providers per mode. In live mode, free real sources replace the demo ones where available;
 * reputation/social/app still use demo data until a vendor adapter is configured.
 *
 * Example for later: if (process.env.VIRUSTOTAL_API_KEY) list.push(virusTotalReputationProvider)
 */
export function getProviders(mode: IntelMode = getIntelMode()): AnyProvider[] {
  if (mode === "live") {
    return [
      ...LOCAL,
      rdapDomainProvider,
      httpWebContentProvider,
      demoReputationProvider,
      demoSocialProvider,
      demoAppProvider,
    ];
  }
  return [
    ...LOCAL,
    demoDomainIntelProvider,
    demoWebContentProvider,
    demoReputationProvider,
    demoSocialProvider,
    demoAppProvider,
  ];
}

async function runOne(p: AnyProvider, entity: NormalizedEntity, brand: BrandReference | null): Promise<ProviderResult> {
  const base = { providerId: p.id, providerName: p.name, kind: p.kind, origin: p.origin, reliability: p.reliability };
  const started = Date.now();

  // Results that depend on the brand must be cached per brand.
  const cacheKey = `${p.id}|${entity.type}|${entity.target}|${entity.url ?? ""}|${p.kind === "brand-similarity" ? JSON.stringify(brand) : ""}`;
  const cached = cacheGet<ProviderResult>(cacheKey);
  if (cached) return { ...cached, latencyMs: 0, message: cached.message ? `${cached.message} (cached)` : "cached" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), p.timeoutMs);
  try {
    const out = await p.collect({ entity, brand, signal: controller.signal });
    const result: ProviderResult = { ...base, ...out, latencyMs: Date.now() - started };
    if (out.status === "OK" || out.status === "NO_DATA") cacheSet(cacheKey, result);
    return result;
  } catch (err) {
    const timedOut = controller.signal.aborted;
    return {
      ...base,
      status: timedOut ? "TIMEOUT" : "ERROR",
      data: null,
      latencyMs: Date.now() - started,
      message: timedOut ? `Timed out after ${p.timeoutMs} ms` : err instanceof Error ? err.message : "Provider failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Runs every applicable provider in parallel. A failing provider never fails the scan. */
export async function collectIntelligence(
  entity: NormalizedEntity,
  brand: BrandReference | null,
  mode: IntelMode = getIntelMode(),
): Promise<ProviderResult[]> {
  const providers = getProviders(mode).filter((p) => p.supports(entity));
  return Promise.all(providers.map((p) => runOne(p, entity, brand)));
}

/** Typed accessor: first successful result of a given kind. */
export function dataOf<K extends ProviderKind>(results: ProviderResult[], kind: K): { data: ProviderDataByKind[K]; result: ProviderResult } | null {
  const r = results.find((x) => x.kind === kind && x.status === "OK" && x.data);
  return r ? { data: r.data as ProviderDataByKind[K], result: r } : null;
}
