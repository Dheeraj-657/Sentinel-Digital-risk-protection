import { prisma } from "./db";
import type { Prisma } from "@/generated/prisma/client";
import type {
  AiAssessment,
  AnalysisReport,
  BrandReference,
  CategoryScore,
  ConfidenceFactor,
  EntityType,
  NormalizedEntity,
  PipelineStage,
  ProviderRunSummary,
  RecommendedAction,
  RiskCategory,
  RiskLevel,
  ScoreAdjustment,
  Signal,
  IntelMode,
} from "./engine/types";
import { CATEGORIES } from "./engine/types";
import { normalizeBrand } from "./engine/entity";

const json = (v: unknown) => v as Prisma.InputJsonValue;

export async function saveReport(report: AnalysisReport, brandId: string | null): Promise<string> {
  const scan = await prisma.scan.create({
    data: {
      entityType: report.entity.type,
      input: report.entity.input,
      target: report.entity.target,
      displayName: report.entity.displayName,
      entity: json(report.entity),
      brandId,
      brandSnapshot: report.brand ? json(report.brand) : undefined,
      riskScore: report.riskScore,
      riskLevel: report.riskLevel,
      confidenceScore: report.confidenceScore,
      breakdown: json({ categories: report.categories, baseScore: report.baseScore }),
      scoreAdjustments: json(report.scoreAdjustments),
      confidenceFactors: json(report.confidenceFactors),
      recommendedActions: json(report.recommendedActions),
      aiAssessment: json(report.aiAssessment),
      aiSource: report.aiAssessment.source,
      providerRuns: json(report.providerRuns),
      pipelineTrace: json(report.pipeline),
      intelMode: report.intelMode,
      durationMs: report.durationMs,
      signals: {
        create: report.signals.map((s, i) => ({
          ruleId: s.ruleId,
          category: s.category,
          severity: s.severity,
          title: s.title,
          description: s.description,
          evidence: s.evidence,
          impact: s.impact,
          provider: s.provider,
          origin: s.origin,
          ordinal: i,
        })),
      },
    },
    select: { id: true },
  });
  return scan.id;
}

type ScanWithSignals = Prisma.ScanGetPayload<{ include: { signals: true } }>;

export function toReport(scan: ScanWithSignals): AnalysisReport {
  const breakdown = scan.breakdown as unknown as { categories: CategoryScore[]; baseScore: number };
  const signals: Signal[] = [...scan.signals]
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((s) => ({
      id: `S${s.ordinal + 1}`,
      ruleId: s.ruleId,
      category: s.category as RiskCategory,
      severity: s.severity as Signal["severity"],
      title: s.title,
      description: s.description,
      evidence: s.evidence,
      impact: s.impact,
      provider: s.provider,
      origin: s.origin as Signal["origin"],
      reliability: 0,
    }));
  return {
    id: scan.id,
    entity: scan.entity as unknown as NormalizedEntity,
    brand: (scan.brandSnapshot as unknown as BrandReference | null) ?? null,
    riskScore: scan.riskScore,
    riskLevel: scan.riskLevel as RiskLevel,
    confidenceScore: scan.confidenceScore,
    riskBreakdown: Object.fromEntries(
      CATEGORIES.map((c) => [c, breakdown.categories.find((x) => x.category === c)?.percent ?? 0]),
    ) as Record<RiskCategory, number>,
    categories: breakdown.categories,
    baseScore: breakdown.baseScore,
    scoreAdjustments: scan.scoreAdjustments as unknown as ScoreAdjustment[],
    confidenceFactors: scan.confidenceFactors as unknown as ConfidenceFactor[],
    signals,
    aiAssessment: scan.aiAssessment as unknown as AiAssessment,
    recommendedActions: scan.recommendedActions as unknown as RecommendedAction[],
    providerRuns: scan.providerRuns as unknown as ProviderRunSummary[],
    pipeline: scan.pipelineTrace as unknown as PipelineStage[],
    intelMode: scan.intelMode as IntelMode,
    durationMs: scan.durationMs,
    timestamp: scan.createdAt.toISOString(),
  };
}

export async function getReport(id: string): Promise<AnalysisReport | null> {
  const scan = await prisma.scan.findUnique({ where: { id }, include: { signals: true } });
  return scan ? toReport(scan) : null;
}

export interface ScanSummary {
  id: string;
  entityType: EntityType;
  target: string;
  displayName: string;
  brandName: string | null;
  riskScore: number;
  riskLevel: RiskLevel;
  confidenceScore: number;
  aiSource: string;
  signalCount: number;
  createdAt: string;
}

export interface ScanQuery {
  type?: EntityType;
  level?: RiskLevel;
  q?: string;
  target?: string;
  brand?: string;
  limit?: number;
  cursor?: string;
}

export async function listScans(query: ScanQuery): Promise<{ items: ScanSummary[]; nextCursor: string | null; total: number }> {
  const limit = Math.min(Math.max(query.limit ?? 25, 1), 100);
  const where: Prisma.ScanWhereInput = {
    ...(query.brand ? { brandId: query.brand } : {}),
    ...(query.type ? { entityType: query.type } : {}),
    ...(query.level ? { riskLevel: query.level } : {}),
    ...(query.target ? { target: query.target } : {}),
    ...(query.q
      ? { OR: [{ target: { contains: query.q.toLowerCase() } }, { input: { contains: query.q } }, { displayName: { contains: query.q } }] }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.scan.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: { brand: { select: { name: true } }, _count: { select: { signals: true } } },
    }),
    prisma.scan.count({ where }),
  ]);
  const page = rows.slice(0, limit);
  return {
    items: page.map((s) => ({
      id: s.id,
      entityType: s.entityType as EntityType,
      target: s.target,
      displayName: s.displayName,
      brandName: s.brand?.name ?? ((s.brandSnapshot as { name?: string } | null)?.name ?? null),
      riskScore: s.riskScore,
      riskLevel: s.riskLevel as RiskLevel,
      confidenceScore: s.confidenceScore,
      aiSource: s.aiSource,
      signalCount: s._count.signals,
      createdAt: s.createdAt.toISOString(),
    })),
    nextCursor: rows.length > limit ? page[page.length - 1].id : null,
    total,
  };
}

/** Earlier scans of the same target, for risk-over-time comparison. */
export async function targetHistory(target: string, take = 12) {
  const rows = await prisma.scan.findMany({
    where: { target },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, riskScore: true, riskLevel: true, confidenceScore: true, createdAt: true, aiSource: true },
  });
  return rows.reverse().map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

export async function dashboardStats() {
  const [total, byLevel, byType, avg, recentHigh, recent, topRules] = await Promise.all([
    prisma.scan.count(),
    prisma.scan.groupBy({ by: ["riskLevel"], _count: { _all: true } }),
    prisma.scan.groupBy({ by: ["entityType"], _count: { _all: true }, _avg: { riskScore: true } }),
    prisma.scan.aggregate({ _avg: { riskScore: true, confidenceScore: true } }),
    // Latest scan per entity, keeping only those currently high or critical.
    listScans({ limit: 100 }).then((r) => {
      const seen = new Set<string>();
      return r.items
        .filter((s) => (seen.has(s.target) ? false : (seen.add(s.target), true)))
        .filter((s) => s.riskLevel === "HIGH" || s.riskLevel === "CRITICAL")
        .slice(0, 6);
    }),
    listScans({ limit: 8 }).then((r) => r.items),
    prisma.signal.groupBy({
      by: ["ruleId", "title"],
      where: { impact: { gt: 0 } },
      _count: { _all: true },
      orderBy: { _count: { ruleId: "desc" } },
      take: 6,
    }),
  ]);
  const levelCount = (l: RiskLevel) => byLevel.find((b) => b.riskLevel === l)?._count._all ?? 0;
  return {
    total,
    levels: {
      VERY_LOW: levelCount("VERY_LOW"),
      LOW: levelCount("LOW"),
      MEDIUM: levelCount("MEDIUM"),
      HIGH: levelCount("HIGH"),
      CRITICAL: levelCount("CRITICAL"),
    } as Record<RiskLevel, number>,
    byType: (["PROFILE", "WEBSITE", "DOMAIN", "APP"] as EntityType[]).map((t) => {
      const r = byType.find((b) => b.entityType === t);
      return { type: t, count: r?._count._all ?? 0, avgRisk: Math.round(r?._avg.riskScore ?? 0) };
    }),
    avgRisk: Math.round(avg._avg.riskScore ?? 0),
    avgConfidence: Math.round(avg._avg.confidenceScore ?? 0),
    recentHigh,
    recent,
    topSignals: dedupeRules(topRules.map((r) => ({ ruleId: r.ruleId, title: r.title, count: r._count._all }))),
  };
}

function dedupeRules(rows: { ruleId: string; title: string; count: number }[]) {
  const m = new Map<string, { ruleId: string; title: string; count: number }>();
  for (const r of rows) {
    const e = m.get(r.ruleId);
    if (e) e.count += r.count;
    else m.set(r.ruleId, { ...r });
  }
  return [...m.values()].sort((a, b) => b.count - a.count).slice(0, 5);
}

/* ---------------- brands ---------------- */

export async function listBrands() {
  const rows = await prisma.brand.findMany({ orderBy: [{ isDemo: "desc" }, { name: "asc" }], include: { _count: { select: { scans: true } } } });
  return rows.map((b) => ({ ...normalizeBrand(b), id: b.id, isDemo: b.isDemo, scanCount: b._count.scans }));
}

export async function getBrand(id: string): Promise<BrandReference | null> {
  const b = await prisma.brand.findUnique({ where: { id } });
  return b ? normalizeBrand(b) : null;
}

/** Full brand row for the console — BrandReference plus id/isDemo/scanCount
 * (same shape listBrands returns, for the detail/edit page). */
export async function getBrandDetail(id: string) {
  const b = await prisma.brand.findUnique({
    where: { id },
    include: { _count: { select: { scans: true } } },
  });
  return b ? { ...normalizeBrand(b), id: b.id, isDemo: b.isDemo, scanCount: b._count.scans } : null;
}
