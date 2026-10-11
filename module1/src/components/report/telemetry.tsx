import type { AnalysisReport, ProviderStatus } from "@/lib/engine/types";
import { Panel, OriginTag } from "@/components/ui/primitives";
import { CheckCircle2, CircleSlash, XCircle, Clock, MinusCircle } from "lucide-react";
import { LEVEL_STYLE, formatDateTime } from "@/lib/ui";
import type { RiskLevel } from "@/lib/engine/types";
import Link from "next/link";

const STATUS: Record<ProviderStatus, { icon: typeof CheckCircle2; cls: string; label: string }> = {
  OK: { icon: CheckCircle2, cls: "text-risk-verylow", label: "Data returned" },
  NO_DATA: { icon: CircleSlash, cls: "text-faint", label: "No data" },
  ERROR: { icon: XCircle, cls: "text-risk-critical", label: "Failed" },
  TIMEOUT: { icon: Clock, cls: "text-risk-high", label: "Timed out" },
  SKIPPED: { icon: MinusCircle, cls: "text-faint", label: "Skipped" },
};

export function ProviderRuns({ report }: { report: AnalysisReport }) {
  return (
    <Panel title="Intelligence sources" aside={`${report.intelMode === "live" ? "Live" : "Demo"} mode`}>
      <ul className="divide-y divide-line-soft">
        {report.providerRuns.map((p) => {
          const s = STATUS[p.status];
          const Icon = s.icon;
          return (
            <li key={p.providerId} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
              <Icon className={`mt-0.5 size-4 shrink-0 ${s.cls}`} aria-label={s.label} />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {p.providerName} <OriginTag origin={p.origin} />
                </p>
                <p className="text-xs text-faint">
                  {s.label}
                  {p.message ? `: ${p.message}` : ""}
                </p>
              </div>
              <span className="text-xs whitespace-nowrap text-faint">{p.latencyMs} ms</span>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

export function PipelineTrace({ report }: { report: AnalysisReport }) {
  return (
    <Panel title="Analysis pipeline" aside={`${report.durationMs} ms total`}>
      <ol className="relative space-y-3 border-l border-line pl-5">
        {report.pipeline.map((p) => (
          <li key={p.stage} className="relative">
            <span
              className={`absolute top-1.5 -left-[25px] size-2.5 rounded-full border-2 border-panel ${p.stage === "explain" ? "bg-ai" : "bg-evidence"}`}
              aria-hidden
            />
            <p className="flex justify-between gap-3 text-sm">
              <span className="font-medium">{p.label}</span>
              <span className="text-xs text-faint">{p.ms} ms</span>
            </p>
            <p className="text-xs break-words text-faint">{p.detail}</p>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

export interface HistoryPoint {
  id: string;
  riskScore: number;
  riskLevel: string;
  confidenceScore: number;
  createdAt: string;
}

export function RiskTrend({ history, currentId }: { history: HistoryPoint[]; currentId: string }) {
  if (history.length < 2) {
    return (
      <Panel title="Risk over time">
        <p className="text-sm text-muted">This is the first scan of this entity. Re-scan later to compare how its risk changes.</p>
      </Panel>
    );
  }
  const W = 320;
  const H = 90;
  const pad = 8;
  const x = (i: number) => pad + (i * (W - pad * 2)) / (history.length - 1);
  const y = (v: number) => H - pad - (v / 100) * (H - pad * 2);
  const path = history.map((h, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(h.riskScore).toFixed(1)}`).join(" ");
  const first = history[0].riskScore;
  const last = history[history.length - 1].riskScore;
  const delta = last - first;
  return (
    <Panel
      title="Risk over time"
      aside={
        <span className={delta > 0 ? "text-risk-high" : delta < 0 ? "text-risk-verylow" : "text-muted"}>
          {delta === 0 ? "No change" : `${delta > 0 ? "+" : ""}${delta} since first scan`}
        </span>
      }
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="h-24 w-full" role="img" aria-label={`Risk scores over ${history.length} scans`}>
        {[20, 40, 60, 80].map((t) => (
          <line key={t} x1={pad} x2={W - pad} y1={y(t)} y2={y(t)} stroke="var(--color-line-soft)" strokeDasharray="2 3" />
        ))}
        <path d={path} fill="none" stroke="var(--color-evidence)" strokeWidth="1.5" />
        {history.map((h, i) => (
          <circle key={h.id} cx={x(i)} cy={y(h.riskScore)} r={h.id === currentId ? 4.5 : 3} fill={LEVEL_STYLE[h.riskLevel as RiskLevel].color} stroke="var(--color-panel)" strokeWidth="1.5" />
        ))}
      </svg>
      <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto text-xs">
        {[...history].reverse().map((h) => (
          <li key={h.id} className="flex justify-between gap-3">
            {h.id === currentId ? (
              <span className="text-fg">{formatDateTime(h.createdAt)} (this scan)</span>
            ) : (
              <Link href={`/scans/${h.id}`} className="text-muted underline-offset-2 hover:text-fg hover:underline">
                {formatDateTime(h.createdAt)}
              </Link>
            )}
            <span style={{ color: LEVEL_STYLE[h.riskLevel as RiskLevel].color }} className="font-semibold">
              {h.riskScore}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
