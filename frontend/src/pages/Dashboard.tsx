import { Link } from "react-router-dom";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  M1RiskLevelBadge,
  PageHeader,
  Skeleton,
  StatCard,
  TableSkeleton,
} from "../components/ui";
import { ThreatTable } from "../components/threat-table";
import { m1, m2, m3 } from "../lib/api";
import { useApi, useEnrichment } from "../lib/hooks";
import { useTenant } from "../lib/tenant";
import {
  CLASSIFICATION_LABEL,
  cx,
  DISCOVERY_JOB_STATUS_LABEL,
  DISCOVERY_JOB_STATUS_TONE,
  formatDateTime,
  JOB_STATUS_LABEL,
  RISK_LEVEL_BAR,
  RISK_LEVEL_LABEL,
} from "../lib/format";
import type { JobStatus, M1Health, RiskLevel, ThreatClassification } from "../lib/types";

const LEVELS: RiskLevel[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
const CLASSIFICATIONS: ThreatClassification[] = ["BRAND_IMPERSONATION", "PHISHING", "SUSPICIOUS_DOMAIN", "UNKNOWN"];

const JOB_TONE: Record<JobStatus, "low" | "medium" | "critical" | "neutral" | "ai"> = {
  QUEUED: "neutral",
  RUNNING: "ai",
  COMPLETED: "low",
  FAILED: "critical",
  CANCELLED: "neutral",
};

/** Count analyses per UTC day for the last `days` days (real job timestamps). */
function dailyActivity(dates: string[], days = 14): { day: string; count: number }[] {
  const buckets = new Map<string, number>();
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
    buckets.set(d.toISOString().slice(0, 10), 0);
  }
  for (const iso of dates) {
    const key = iso.slice(0, 10);
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return [...buckets.entries()].map(([day, count]) => ({ day, count }));
}

export default function Dashboard() {
  const { tenant } = useTenant();
  const threats = useApi(() => m2.listThreats({ limit: 200 }, tenant), [tenant]);
  const entities = useApi(() => m3.listEntities({ limit: 1 }, tenant), [tenant]);
  const jobs = useApi(() => m2.listJobs({ limit: 100 }, tenant), [tenant]);
  const discovery = useApi(() => m2.listDiscovery({ limit: 5 }, tenant), [tenant]);
  const brands = useApi(() => m1.listBrands(), []);
  const m1Health = useApi(() => m1.health(), []);
  const stats = useApi(() => m1.getStats(), []);
  const enrich = useEnrichment();

  const items = threats.data?.items ?? [];
  const open = items.filter((threat) => threat.status === "OPEN").length;
  const confirmed = items.filter((threat) => threat.status === "CONFIRMED").length;
  const byLevel: Record<RiskLevel, number> = {
    CRITICAL: items.filter((t) => t.risk_level === "CRITICAL").length,
    HIGH: items.filter((t) => t.risk_level === "HIGH").length,
    MEDIUM: items.filter((t) => t.risk_level === "MEDIUM").length,
    LOW: items.filter((t) => t.risk_level === "LOW").length,
  };
  const total = items.length;
  const truncated = (threats.data?.total ?? 0) > items.length;
  const jobItems = jobs.data?.items ?? [];
  const activity = dailyActivity(jobItems.map((j) => j.created_at));
  const activityMax = Math.max(1, ...activity.map((a) => a.count));

  return (
    <>
      <PageHeader
        title="Overview"
        description="Security posture across the risk engine (Module 2), evidence store (Module 3) and brand registry (Module 1). Every number below is read live from those services."
        actions={
          <>
            <Link
              to="/analysis/new"
              className="rounded-md bg-action px-3 py-1.5 text-[13px] font-semibold text-on-action transition hover:bg-action-strong"
            >
              New threat analysis
            </Link>
            <Link
              to="/scan/new"
              className="rounded-md border border-line bg-raised/70 px-3 py-1.5 text-[13px] font-medium text-fg transition hover:border-action/60"
            >
              New scan
            </Link>
          </>
        }
      />

      {/* Posture: critical risk is the first thing on screen. */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader
            title="Threat posture"
            description="Risk-engine verdicts for this tenant, by level. Select a level to open the filtered register."
            actions={
              <Link to="/threats" className="text-xs font-medium text-action hover:text-fg">
                Threat register
              </Link>
            }
          />
          <div className="px-4 py-5 sm:px-5">
            {threats.loading ? (
              <Skeleton className="h-24 w-full" />
            ) : threats.error ? (
              <ErrorState error={threats.error} onRetry={threats.reload} context="threats" />
            ) : (
              <>
                <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
                  {LEVELS.map((level) => (
                    <Link
                      key={level}
                      to={`/threats?level=${level}`}
                      aria-label={`Filter threats by ${level.toLowerCase()} risk level`}
                      className="group rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-action"
                    >
                      <span className="flex items-center gap-2 text-xs text-muted group-hover:text-fg">
                        <span className={cx("size-2 rounded-full", RISK_LEVEL_BAR[level])} aria-hidden />
                        {RISK_LEVEL_LABEL[level]}
                      </span>
                      <span
                        className={cx(
                          "font-condensed mt-1 block font-mono text-4xl font-bold leading-none",
                          byLevel[level] > 0 && (level === "CRITICAL" || level === "HIGH")
                            ? level === "CRITICAL"
                              ? "text-risk-critical"
                              : "text-risk-high"
                            : "text-fg",
                        )}
                      >
                        {byLevel[level]}
                      </span>
                    </Link>
                  ))}
                </div>
                <div
                  className="mt-5 flex h-2.5 w-full overflow-hidden rounded-full bg-white/[0.05]"
                  role="img"
                  aria-label={`Severity distribution: ${LEVELS.map((l) => `${byLevel[l]} ${l.toLowerCase()}`).join(", ")}`}
                >
                  {total > 0
                    ? LEVELS.map((level) =>
                        byLevel[level] ? (
                          <div
                            key={level}
                            className={cx("h-full border-r-2 border-ink last:border-r-0", RISK_LEVEL_BAR[level])}
                            style={{ width: `${(byLevel[level] / total) * 100}%` }}
                          />
                        ) : null,
                      )
                    : null}
                </div>
                {total > 0 ? (
                  <div className="mt-5 border-t border-line-soft pt-4">
                    <p className="mb-2 text-xs text-muted">By classification</p>
                    <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                      {CLASSIFICATIONS.filter((c) => items.some((t) => t.classification === c)).map((c) => {
                        const count = items.filter((t) => t.classification === c).length;
                        return (
                          <li key={c}>
                            <Link
                              to={`/threats?q=${encodeURIComponent(CLASSIFICATION_LABEL[c])}`}
                              className="flex items-center justify-between gap-3 rounded-sm text-[13px] text-fg hover:text-action"
                            >
                              <span>{CLASSIFICATION_LABEL[c]}</span>
                              <span className="font-mono text-xs text-muted">{count}</span>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}
                <p className="mt-3 text-xs text-faint">
                  {total === 0
                    ? "No verdicts yet. Run an analysis on a registered entity."
                    : `${total} verdict${total === 1 ? "" : "s"}, ${open} awaiting triage.${truncated ? " Showing the 200 highest-risk verdicts." : ""}`}
                </p>
              </>
            )}
          </div>
        </Card>

        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Protected brands" value={brands.data?.items?.length ?? "—"} hint="Brand registry" to="/brands" />
          <StatCard label="Entities" value={entities.data?.total ?? "—"} hint="Evidence store" to="/entities" />
          <StatCard label="Threats" value={threats.data?.total ?? "—"} hint="Risk engine verdicts" to="/threats" />
          <StatCard
            label="Open"
            value={threats.loading ? "…" : open}
            hint="Awaiting triage"
            tone={open > 0 ? "medium" : "neutral"}
            to="/threats?status=OPEN"
          />
          <StatCard
            label="Confirmed"
            value={threats.loading ? "…" : confirmed}
            hint="Triaged by an analyst"
            tone="low"
            to="/threats?status=CONFIRMED"
          />
          <StatCard label="Scans" value={stats.data?.total ?? "—"} hint="Sentinel engine" to="/scans" />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader
            title="Highest-risk threats"
            description="Ranked exactly as the risk engine orders them. Entity names open the investigation workspace."
            actions={
              <Link to="/threats" className="text-xs font-medium text-action hover:text-fg">
                All threats
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
            />
          ) : (
            <ThreatTable threats={items.slice(0, 6)} />
          )}
        </Card>

        <Card>
          <CardHeader
            title="Latest investigations"
            description="Risk-engine analysis jobs, newest first."
            actions={
              <Link to="/analysis/history" className="text-xs font-medium text-action hover:text-fg">
                History
              </Link>
            }
          />
          {jobs.loading ? (
            <TableSkeleton rows={4} cols={2} />
          ) : jobs.error ? (
            <ErrorState error={jobs.error} onRetry={jobs.reload} context="analysis jobs" />
          ) : jobItems.length === 0 ? (
            <EmptyState title="No analyses yet" description="Analysis jobs appear here as soon as one is submitted." />
          ) : (
            <>
              <div className="px-4 pt-4 sm:px-5">
                <p className="text-xs text-muted">Analyses per day, last 14 days</p>
                <div className="mt-2 flex h-12 items-end gap-1" role="img" aria-label={`Analyses per day over the last 14 days: ${activity.map((a) => a.count).join(", ")}`}>
                  {activity.map((a) => (
                    <div key={a.day} className="flex h-full flex-1 items-end" title={`${a.day}: ${a.count}`}>
                      <div
                        className={cx("w-full rounded-sm", a.count ? "bg-action/80" : "bg-white/[0.06]")}
                        style={{ height: `${a.count ? Math.max(12, (a.count / activityMax) * 100) : 6}%` }}
                      />
                    </div>
                  ))}
                </div>
              </div>
              <ul className="mt-2 divide-y divide-line-soft">
                {jobItems.slice(0, 5).map((job) => (
                  <li key={job.job_id}>
                    <Link
                      to={`/analysis/${job.job_id}`}
                      className="flex items-center justify-between gap-3 px-4 py-2.5 transition hover:bg-white/[0.03] sm:px-5"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] text-fg">{enrich.entityName(job.entity_id)}</span>
                        <span className="block truncate text-[11px] text-faint">
                          vs {enrich.brandName(job.brand_id)}, {formatDateTime(job.created_at)}
                        </span>
                      </span>
                      <Badge tone={JOB_TONE[job.status]}>{JOB_STATUS_LABEL[job.status]}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader
            title="Recent high-risk scans"
            description={
              stats.data
                ? `Sentinel engine (Module 1): avg risk ${Math.round(stats.data.avgRisk)}, avg confidence ${Math.round(stats.data.avgConfidence)}`
                : "Module 1 scan engine aggregates"
            }
            actions={
              <Link to="/scans" className="text-xs font-medium text-action hover:text-fg">
                All scans
              </Link>
            }
          />
          {stats.loading ? (
            <TableSkeleton rows={3} />
          ) : stats.error ? (
            <ErrorState error={stats.error} onRetry={stats.reload} context="scan stats" />
          ) : !stats.data || stats.data.recentHigh.length === 0 ? (
            <EmptyState
              title="No high-risk scans"
              description="High and critical results from the Sentinel scan engine appear here."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-line-soft text-xs text-faint">
                    <th scope="col" className="px-4 py-2.5 font-medium sm:px-5">Target</th>
                    <th scope="col" className="px-4 py-2.5 font-medium">Risk</th>
                    <th scope="col" className="hidden px-4 py-2.5 font-medium sm:table-cell">Confidence</th>
                    <th scope="col" className="hidden px-4 py-2.5 font-medium md:table-cell">When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {stats.data.recentHigh.slice(0, 5).map((scan) => (
                    <tr key={scan.id} className="transition hover:bg-white/[0.03]">
                      <td className="px-4 py-2.5 sm:px-5">
                        <Link to={`/scans/${scan.id}`} className="text-fg hover:text-action">
                          {scan.displayName}
                        </Link>
                        <span className="block font-mono text-[11px] text-faint">{scan.target}</span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5">
                        <span className="flex items-center gap-2">
                          <M1RiskLevelBadge level={scan.riskLevel} />
                          <span className="font-mono text-xs text-fg">{scan.riskScore}</span>
                        </span>
                      </td>
                      <td className="hidden px-4 py-2.5 font-mono text-xs text-muted sm:table-cell">{scan.confidenceScore}</td>
                      <td className="hidden whitespace-nowrap px-4 py-2.5 text-xs text-muted md:table-cell">
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
          <CardHeader title="Top scan signals" description="Detection rules most often fired by Sentinel scans." />
          {stats.loading ? (
            <div className="px-4 py-4 text-xs text-faint sm:px-5">Loading…</div>
          ) : !stats.data || stats.data.topSignals.length === 0 ? (
            <EmptyState title="No signals detected" description="Detection-rule hits from Sentinel scans are tallied here." />
          ) : (
            <ul className="divide-y divide-line-soft">
              {stats.data.topSignals.slice(0, 5).map((signal) => (
                <li key={signal.ruleId} className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5">
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] text-fg">{signal.title}</span>
                    <span className="font-mono text-[11px] text-faint">{signal.ruleId}</span>
                  </span>
                  <span className="font-mono text-xs text-muted">{signal.count}×</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Discovery runs"
            description="Brand-DNA-driven discovery jobs and their honest per-provider outcome."
            actions={
              <Link to="/discovery" className="text-xs font-medium text-action hover:text-fg">
                Discovery center
              </Link>
            }
          />
          {discovery.loading ? (
            <TableSkeleton rows={3} cols={3} />
          ) : discovery.error ? (
            <ErrorState error={discovery.error} onRetry={discovery.reload} context="discovery jobs" />
          ) : !discovery.data || discovery.data.items.length === 0 ? (
            <EmptyState title="No discovery runs" description="Start one from a brand's page with Discover threats." />
          ) : (
            <ul className="divide-y divide-line-soft">
              {discovery.data.items.map((job) => (
                <li key={job.job_id}>
                  <Link
                    to={`/discovery/${job.job_id}`}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 transition hover:bg-white/[0.03] sm:px-5"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] text-fg">{enrich.brandName(job.brand_id)}</span>
                      <span className="block text-[11px] text-faint">
                        {job.candidate_count} candidate{job.candidate_count === 1 ? "" : "s"}, {formatDateTime(job.created_at)}
                      </span>
                    </span>
                    <Badge tone={DISCOVERY_JOB_STATUS_TONE[job.status]}>{DISCOVERY_JOB_STATUS_LABEL[job.status]}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Data sources" description="What each connected module is actually running right now." />
          <dl className="divide-y divide-line-soft text-[13px]">
            <SourceRow label="Brand registry (Module 1)">
              {brands.loading
                ? "Loading…"
                : brands.error
                  ? <span className="text-risk-critical">Unreachable</span>
                  : `${brands.data?.items?.length ?? 0} protected brands`}
              {m1Health.data ? <M1ModeNote health={m1Health.data} /> : null}
            </SourceRow>
            <SourceRow label="Risk engine (Module 2)">
              {threats.error ? <span className="text-risk-critical">Unreachable</span> : "Deterministic weighted factor scoring; engine version stamped on every verdict."}
            </SourceRow>
            <SourceRow label="Evidence store (Module 3)">
              {entities.error ? <span className="text-risk-critical">Unreachable</span> : "Entities, evidence items and source provenance, tenant-scoped."}
            </SourceRow>
            <SourceRow label="Campaign detection">
              <span className="text-muted">
                Not implemented in the risk engine. Exact shared-identifier links are explorable in the{" "}
                <Link to="/graph" className="text-action hover:text-fg">threat graph</Link>.
              </span>
            </SourceRow>
          </dl>
          <p className="border-t border-line-soft px-4 py-3 text-xs text-faint sm:px-5">
            Records named <span className="font-mono">SYNTHETIC TEST_ONLY</span> are fixtures, not live discovery.
          </p>
        </Card>
      </div>
    </>
  );
}

function SourceRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 px-4 py-3 sm:grid-cols-[11rem_1fr] sm:px-5">
      <dt className="text-xs text-faint">{label}</dt>
      <dd className="text-fg">{children}</dd>
    </div>
  );
}

function M1ModeNote({ health }: { health: M1Health }) {
  return (
    <span className="block text-xs text-muted">
      Intel mode: {health.intelMode === "demo" ? "demo dataset" : "live"}. AI assessments:{" "}
      {health.ai.configured ? `${health.ai.provider} (${health.ai.model})` : "template only, no AI key set"}.
    </span>
  );
}
