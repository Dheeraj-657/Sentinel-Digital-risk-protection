import { Link } from "react-router-dom";
import { Card, CardHeader, EmptyState, ErrorState, M1RiskLevelBadge, PageHeader, StatCard, TableSkeleton } from "../components/ui";
import { ThreatTable } from "../components/threat-table";
import { m1, m2, m3 } from "../lib/api";
import { useApi, useEnrichment } from "../lib/hooks";
import { useTenant } from "../lib/tenant";
import { formatDateTime } from "../lib/format";
import type { M1Health } from "../lib/types";

export default function Dashboard() {
  const { tenant } = useTenant();
  const threats = useApi(() => m2.listThreats({ limit: 200 }, tenant), [tenant]);
  const entities = useApi(() => m3.listEntities({ limit: 1 }, tenant), [tenant]);
  const brands = useApi(() => m1.listBrands(), []);
  const m1Health = useApi(() => m1.health(), []);
  const stats = useApi(() => m1.getStats(), []);
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

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
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
        <StatCard label="Scans" value={stats.data?.total ?? "—"} hint="Sentinel engine" />
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

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Recent high-risk scans"
            description={
              stats.data
                ? `avg risk ${Math.round(stats.data.avgRisk)} · avg confidence ${Math.round(stats.data.avgConfidence)}`
                : "Module 1 scan engine aggregates"
            }
            actions={
              <Link
                to="/scans"
                className="text-xs font-medium text-action hover:text-fg"
              >
                All scans →
              </Link>
            }
          />
          {stats.loading ? (
            <TableSkeleton rows={3} />
          ) : stats.error ? (
            <ErrorState error={stats.error} onRetry={stats.reload} context="stats" />
          ) : !stats.data || stats.data.recentHigh.length === 0 ? (
            <EmptyState
              title="No scans yet"
              description="Run the Sentinel engine on a profile, website, domain or app — its high-risk results land here."
              action={
                <Link
                  to="/scan/new"
                  className="rounded border border-action/60 bg-action/15 px-3 py-1.5 text-xs font-semibold text-action transition hover:bg-action/25"
                >
                  New scan
                </Link>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-line-soft text-[11px] uppercase tracking-widest text-faint">
                    <th scope="col" className="px-4 py-2.5 font-medium sm:px-5">
                      Target
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-medium">
                      Risk
                    </th>
                    <th scope="col" className="hidden px-4 py-2.5 font-medium sm:table-cell">
                      Confidence
                    </th>
                    <th scope="col" className="hidden px-4 py-2.5 font-medium md:table-cell">
                      When
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {stats.data.recentHigh.slice(0, 5).map((scan) => (
                    <tr key={scan.id} className="transition hover:bg-raised/50">
                      <td className="px-4 py-3 sm:px-5">
                        <Link to={`/scans/${scan.id}`} className="text-fg hover:text-action">
                          {scan.displayName}
                        </Link>
                        <span className="block font-mono text-[11px] text-faint">{scan.target}</span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className="flex items-center gap-2">
                          <M1RiskLevelBadge level={scan.riskLevel} />
                          <span className="font-mono text-xs text-fg">{scan.riskScore}</span>
                        </span>
                      </td>
                      <td className="hidden px-4 py-3 font-mono text-xs text-muted sm:table-cell">
                        {scan.confidenceScore}
                      </td>
                      <td className="hidden whitespace-nowrap px-4 py-3 text-xs text-muted md:table-cell">
                        {formatDateTime(scan.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Top scan signals"
            description="Detection rules most frequently fired by Sentinel scans."
          />
          {stats.loading ? (
            <div className="px-4 py-4 text-xs text-faint sm:px-5">Loading…</div>
          ) : !stats.data || stats.data.topSignals.length === 0 ? (
            <EmptyState
              title="No signals detected"
              description="Detection-rule hits from Sentinel scans are tallied here."
            />
          ) : (
            <ul className="divide-y divide-line-soft">
              {stats.data.topSignals.slice(0, 6).map((signal) => (
                <li
                  key={signal.ruleId}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-fg">{signal.title}</span>
                    <span className="font-mono text-[11px] text-faint">{signal.ruleId}</span>
                  </span>
                  <span className="font-mono text-xs text-muted">{signal.count}×</span>
                </li>
              ))}
            </ul>
          )}
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
