import { Link } from "react-router-dom";
import { Card, CardHeader, EmptyState, ErrorState, PageHeader, StatCard, TableSkeleton } from "../components/ui";
import { ThreatTable } from "../components/threat-table";
import { m1, m2, m3 } from "../lib/api";
import { useApi, useEnrichment } from "../lib/hooks";
import { useTenant } from "../lib/tenant";
import type { M1Health } from "../lib/types";

export default function Dashboard() {
  const { tenant } = useTenant();
  const threats = useApi(() => m2.listThreats({ limit: 200 }, tenant), [tenant]);
  const entities = useApi(() => m3.listEntities({ limit: 1 }, tenant), [tenant]);
  const brands = useApi(() => m1.listBrands(), []);
  const m1Health = useApi(() => m1.health(), []);
  const enrich = useEnrichment();

  const items = threats.data?.items ?? [];
  const open = items.filter((threat) => threat.status === "OPEN").length;
  const severe = items.filter(
    (threat) => threat.risk_level === "CRITICAL" || threat.risk_level === "HIGH",
  ).length;
  const confirmed = items.filter((threat) => threat.status === "CONFIRMED").length;

  const byLevel = {
    CRITICAL: items.filter((t) => t.risk_level === "CRITICAL").length,
    HIGH: items.filter((t) => t.risk_level === "HIGH").length,
    MEDIUM: items.filter((t) => t.risk_level === "MEDIUM").length,
    LOW: items.filter((t) => t.risk_level === "LOW").length,
  };
  const levelMax = Math.max(1, ...Object.values(byLevel));

  return (
    <>
      <PageHeader
        title="Overview"
        description="Live aggregates from the Module 2 risk engine, Module 3 evidence store and Module 1 brand registry."
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Threats" value={threats.data?.total ?? "—"} hint="risk engine output" />
        <StatCard label="Open" value={threats.loading ? "…" : open} hint="awaiting triage" tone="medium" />
        <StatCard
          label="High + critical"
          value={threats.loading ? "…" : severe}
          hint="risk level"
          tone={severe > 0 ? "critical" : "low"}
        />
        <StatCard label="Confirmed" value={threats.loading ? "…" : confirmed} hint="triaged by analyst" tone="low" />
        <StatCard label="Entities" value={entities.data?.total ?? "—"} hint="evidence store" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Severity mix"
            description="Distribution of risk levels across all threats for this tenant."
          />
          <div className="space-y-3 px-4 py-4 sm:px-5">
            {(["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const).map((level) => (
              <div key={level} className="flex items-center gap-3">
                <span className="w-16 text-[11px] font-semibold uppercase tracking-widest text-muted">
                  {level}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded bg-raised">
                  <div
                    className={`h-full rounded bg-risk-${level.toLowerCase()}`}
                    style={{ width: `${(byLevel[level] / levelMax) * 100}%` }}
                  />
                </div>
                <span className="w-8 text-right font-mono text-xs text-fg">{byLevel[level]}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Sources of truth"
            description="What each connected module is actually running."
          />
          <div className="space-y-3 px-4 py-4 text-xs leading-relaxed text-muted sm:px-5">
            <p>
              <span className="font-semibold text-fg">Brands:</span>{" "}
              {brands.loading
                ? "loading…"
                : brands.error
                  ? "Module 1 unreachable"
                  : `${brands.data?.items.length ?? 0} protected (Module 1)`}
              {m1Health.data ? (
                <M1ModeNote health={m1Health.data} />
              ) : null}
            </p>
            <p>
              <span className="font-semibold text-fg">Risk engine:</span> Module 2 — deterministic
              weighted factor scoring, engine version in each threat detail.
            </p>
            <p>
              <span className="font-semibold text-fg">Evidence:</span> Module 3 — entities,
              evidence items and source provenance, tenant-scoped.
            </p>
            <p className="border-t border-line-soft pt-3 text-faint">
              Entities seeded from synthetic fixtures are labelled{" "}
              <span className="font-mono">SYNTHETIC TEST_ONLY</span> in their names. No live
              internet discovery is claimed.
            </p>
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader
          title="Recent threats"
          description="Highest risk first — exactly as the risk engine ranks them."
          actions={
            <Link
              to="/threats"
              className="text-xs font-medium text-action hover:text-fg"
            >
              All threats →
            </Link>
          }
        />
        {threats.loading ? (
          <TableSkeleton rows={4} />
        ) : threats.error ? (
          <ErrorState error={threats.error} onRetry={threats.reload} context="threats" />
        ) : items.length === 0 ? (
          <EmptyState
            title="No threats yet"
            description="Run an analysis on a registered entity to produce the first risk assessment."
            action={
              <Link
                to="/analysis/new"
                className="rounded border border-action/60 bg-action/15 px-3 py-1.5 text-xs font-semibold text-action transition hover:bg-action/25"
              >
                Run analysis
              </Link>
            }
          />
        ) : (
          <>
            <ThreatTable threats={items.slice(0, 6)} />
            {enrich.entitiesLoading ? null : null}
          </>
        )}
      </Card>
    </>
  );
}

function M1ModeNote({ health }: { health: M1Health }) {
  return (
    <span className="text-faint">
      {" "}
      · intel: {health.intelMode}
      {health.ai.configured ? ` · AI: ${health.ai.provider}` : " · AI: template only"}
    </span>
  );
}
