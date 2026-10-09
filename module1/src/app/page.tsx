import Link from "next/link";
import { dashboardStats } from "@/lib/scans";
import { RISK_LEVELS, type RiskLevel } from "@/lib/engine/types";
import { ENTITY_LABEL, LEVEL_STYLE, timeAgo } from "@/lib/ui";
import { EmptyState, LevelBadge, Panel } from "@/components/ui/primitives";
import { ScanSearch } from "lucide-react";
import { QuickScan } from "@/components/quick-scan";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const s = await dashboardStats();
  const urgent = s.levels.CRITICAL + s.levels.HIGH;
  const levels = [...RISK_LEVELS].reverse() as RiskLevel[];

  return (
    <div className="mx-auto max-w-[1280px] space-y-8">
      <header className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <h1 className="text-3xl font-bold tracking-tight">Threat overview</h1>
          <p className="mt-2 text-muted">
            {s.total === 0
              ? "No entities analysed yet."
              : `${s.total} entities analysed. ${urgent} rated high or critical, average risk ${s.avgRisk}/100 at ${s.avgConfidence}% average confidence.`}
          </p>
        </div>
        <QuickScan />
      </header>

      {s.total === 0 ? (
        <EmptyState
          title="Start by analysing a suspicious entity"
          body="Paste a profile, website, domain or app into the scanner. To load the sample cases, run `npm run db:seed`."
          action={
            <Link href="/scan" className="inline-flex items-center gap-2 rounded-md bg-action px-4 py-2 text-sm font-semibold text-ink">
              <ScanSearch className="size-4" aria-hidden /> Open the scanner
            </Link>
          }
        />
      ) : (
        <>
          {/* Posture: one bar, same visual language as the report ruler */}
          <section aria-label="Risk distribution">
            <div className="flex h-3 w-full overflow-hidden rounded-sm bg-line-soft">
              {levels.map((l) =>
                s.levels[l] ? (
                  <div
                    key={l}
                    className="h-full border-r-2 border-ink last:border-r-0"
                    style={{ width: `${(s.levels[l] / s.total) * 100}%`, background: LEVEL_STYLE[l].color }}
                    title={`${LEVEL_STYLE[l].label}: ${s.levels[l]}`}
                  />
                ) : null,
              )}
            </div>
            <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
              {levels.map((l) => (
                <li key={l}>
                  <Link href={`/history?level=${l}`} className="flex items-center gap-2 text-muted hover:text-fg">
                    <span className="size-2.5 rounded-sm" style={{ background: LEVEL_STYLE[l].color }} aria-hidden />
                    {LEVEL_STYLE[l].label}
                    <span className="font-semibold text-fg">{s.levels[l]}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <Panel title="Needs action" aside="High and critical, most recent first">
              {s.recentHigh.length === 0 ? (
                <p className="text-sm text-muted">Nothing high or critical in the latest scans.</p>
              ) : (
                <ul className="divide-y divide-line-soft">
                  {s.recentHigh.map((r) => (
                    <li key={r.id}>
                      <Link href={`/scans/${r.id}`} className="group flex items-center gap-4 py-3 first:pt-0">
                        <span className="font-condensed w-12 text-right text-3xl leading-none font-extrabold" style={{ color: LEVEL_STYLE[r.riskLevel].color }}>
                          {r.riskScore}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-mono text-[13px] group-hover:underline">{r.target}</span>
                          <span className="text-xs text-faint">
                            {ENTITY_LABEL[r.entityType]}
                            {r.brandName ? `, impersonating ${r.brandName}` : ""}, {r.signalCount} signals
                          </span>
                        </span>
                        <span className="hidden sm:block">
                          <LevelBadge level={r.riskLevel} size="sm" />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Most frequent risk signals">
              {s.topSignals.length === 0 ? (
                <p className="text-sm text-muted">No risk signals recorded yet.</p>
              ) : (
                <ol className="space-y-3">
                  {s.topSignals.map((t) => (
                    <li key={t.ruleId} className="flex items-baseline justify-between gap-3 text-sm">
                      <span>{t.title}</span>
                      <span className="shrink-0 text-muted">
                        <span className="font-semibold text-fg">{t.count}</span> detections
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </Panel>
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <Panel title="By entity type">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-faint">
                  <tr>
                    <th className="pb-2 font-medium">Type</th>
                    <th className="pb-2 text-right font-medium">Scans</th>
                    <th className="pb-2 text-right font-medium">Average risk</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {s.byType.map((t) => (
                    <tr key={t.type}>
                      <td className="py-2.5">{ENTITY_LABEL[t.type]}</td>
                      <td className="py-2.5 text-right text-muted">{t.count}</td>
                      <td className="py-2.5 text-right font-semibold">{t.count ? t.avgRisk : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>

            <Panel title="Recent scans" aside={<Link href="/history" className="text-action hover:underline">All scans</Link>}>
              <ul className="divide-y divide-line-soft">
                {s.recent.map((r) => (
                  <li key={r.id}>
                    <Link href={`/scans/${r.id}`} className="group flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                      <span className="w-8 text-right font-bold" style={{ color: LEVEL_STYLE[r.riskLevel].color }}>
                        {r.riskScore}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-mono text-[13px] group-hover:underline">{r.target}</span>
                      <span className="text-xs whitespace-nowrap text-faint">{timeAgo(r.createdAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
