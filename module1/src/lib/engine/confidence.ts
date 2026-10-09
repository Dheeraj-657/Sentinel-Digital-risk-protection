/**
 * Confidence = how much we trust the assessment, independent of how risky it is.
 *
 *   Data coverage     (40) — share of applicable providers that returned data
 *   Independence      (25) — distinct risk categories with evidence (4+ = full)
 *   Source reliability(20) — reliability of the sources behind the evidence, weighted by impact
 *   Brand reference   (15) — whether official brand assets were supplied for comparison
 *   Conflict         (−10) — strong risk and strong mitigating evidence at the same time
 */
import type { BrandReference, ConfidenceFactor, ConfidenceResult, ProviderResult, Signal } from "./types";

const STATUS_WEIGHT: Record<ProviderResult["status"], number> = {
  OK: 1,
  NO_DATA: 0.35, // the source answered, but had nothing — weak evidence of absence
  ERROR: 0,
  TIMEOUT: 0,
  SKIPPED: 0,
};

export function computeConfidence(results: ProviderResult[], signals: Signal[], brand: BrandReference | null): ConfidenceResult {
  const factors: ConfidenceFactor[] = [];

  const applicable = results.filter((r) => r.status !== "SKIPPED");
  const coverage = applicable.length ? applicable.reduce((n, r) => n + STATUS_WEIGHT[r.status], 0) / applicable.length : 0;
  const ok = applicable.filter((r) => r.status === "OK").length;
  const failed = applicable.filter((r) => r.status === "ERROR" || r.status === "TIMEOUT").length;
  factors.push({
    key: "coverage",
    label: "Data coverage",
    max: 40,
    points: Math.round(40 * coverage),
    detail: `${ok}/${applicable.length} intelligence sources returned data${failed ? `, ${failed} failed` : ""}`,
  });

  const active = signals.filter((s) => s.impact !== 0);
  const cats = new Set(active.map((s) => s.category));
  factors.push({
    key: "independence",
    label: "Independent evidence",
    max: 25,
    points: Math.round(25 * Math.min(1, cats.size / 4)),
    detail: `Evidence spans ${cats.size} independent categor${cats.size === 1 ? "y" : "ies"}`,
  });

  let rel: number;
  if (active.length) {
    const w = active.reduce((n, s) => n + Math.abs(s.impact), 0);
    rel = active.reduce((n, s) => n + s.reliability * Math.abs(s.impact), 0) / w;
  } else {
    const okRes = applicable.filter((r) => r.status === "OK");
    rel = okRes.length ? (okRes.reduce((n, r) => n + r.reliability, 0) / okRes.length) * 0.6 : 0;
  }
  const demoShare = active.length ? active.filter((s) => s.origin === "DEMO").length / active.length : 0;
  factors.push({
    key: "reliability",
    label: "Source reliability",
    max: 20,
    points: Math.round(20 * rel),
    detail: active.length
      ? `Impact-weighted source reliability ${Math.round(rel * 100)}%${demoShare ? ` (${Math.round(demoShare * 100)}% of signals from demo data)` : ""}`
      : "No signals fired; based on the reliability of sources that returned clean data",
  });

  const hasAssets = Boolean(
    brand && (brand.officialDomains.length || brand.officialHandles.length || brand.appDevelopers.length || brand.packagePrefixes.length),
  );
  factors.push({
    key: "reference",
    label: "Brand reference",
    max: 15,
    points: hasAssets ? 15 : brand ? 8 : 0,
    detail: hasAssets
      ? `Compared against official ${brand!.name} assets`
      : brand
        ? `Brand name only — no official assets to compare against`
        : "No protected brand supplied — impersonation checks limited",
  });

  const risk = signals.filter((s) => s.impact > 0).reduce((n, s) => n + s.impact, 0);
  const mitig = signals.filter((s) => s.impact < 0).reduce((n, s) => n - s.impact, 0);
  const conflict = risk >= 25 && mitig >= 10;
  factors.push({
    key: "conflict",
    label: "Conflicting evidence",
    max: 0,
    points: conflict ? -10 : 0,
    detail: conflict ? `Strong risk (${risk} pts) and strong mitigating evidence (${mitig} pts) disagree` : "No material conflict between signals",
  });

  const total = factors.reduce((n, f) => n + f.points, 0);
  return { confidenceScore: Math.max(5, Math.min(97, total)), factors };
}
