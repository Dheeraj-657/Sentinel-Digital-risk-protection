import type { AnalysisReport } from "@/lib/engine/types";
import { ENTITY_LABEL, formatDateTime } from "@/lib/ui";
import { Panel } from "@/components/ui/primitives";
import { ScoreRuler } from "./score-ruler";
import { CategoryBreakdown, ConfidencePanel, ScoreMath } from "./breakdown";
import { ActionsPanel, AiAssessmentPanel, WhyRisky } from "./assessment";
import { SignalList } from "./signal-list";
import { PipelineTrace, ProviderRuns, RiskTrend, type HistoryPoint } from "./telemetry";
import { ReportActions } from "./report-actions";
import { Globe, Link2, AtSign, Smartphone } from "lucide-react";

const ICON = { PROFILE: AtSign, WEBSITE: Link2, DOMAIN: Globe, APP: Smartphone };

/** Shows URLs as inert text so a malicious link is never one click away. */
function defang(s: string) {
  return s.replace(/^http/i, "hxxp").replace(/\./g, "[.]");
}

export function ReportView({ report, history }: { report: AnalysisReport; history: HistoryPoint[] }) {
  const Icon = ICON[report.entity.type];
  const e = report.entity;
  const risky = report.signals.filter((s) => s.impact > 0).length;
  const demoSignals = report.signals.filter((s) => s.origin === "DEMO").length;

  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      {/* Entity header */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm text-muted">
            <Icon className="size-4" aria-hidden />
            {ENTITY_LABEL[e.type]}
            {e.platform && e.platform !== "other" && <span className="capitalize">on {e.platform === "x" ? "X" : e.platform}</span>}
          </p>
          <h1 className="mt-1 font-mono text-2xl font-semibold tracking-tight break-all sm:text-[28px]">{e.displayName}</h1>
          <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <div className="flex gap-1.5">
              <dt className="text-faint">Submitted</dt>
              <dd className="font-mono text-[13px] break-all text-muted">{e.type === "WEBSITE" ? defang(e.input) : e.input}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-faint">Compared against</dt>
              <dd className="text-muted">{report.brand?.name ?? "No protected brand"}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-faint">Scanned</dt>
              <dd className="text-muted">
                <time dateTime={report.timestamp}>{formatDateTime(report.timestamp)}</time>
              </dd>
            </div>
          </dl>
        </div>
        <ReportActions report={report} />
      </header>

      {demoSignals > 0 && (
        <p className="rounded-md border border-risk-medium/30 bg-risk-medium/8 px-4 py-2.5 text-sm text-muted">
          <span className="font-semibold text-risk-medium">Demo intelligence in use.</span> {demoSignals} of {report.signals.length} signals come from
          the curated demo dataset (tagged “Demo data”). Lexical, brand-similarity and URL-structure signals are computed from the real input.
        </p>
      )}

      {/* Verdict */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <Panel>
          <ScoreRuler report={report} />
          <p className="mt-5 border-t border-line-soft pt-4 text-sm text-muted">
            {risky
              ? `${risky} risk signal${risky > 1 ? "s" : ""} across ${report.categories.filter((c) => c.points > 0).length} categories.`
              : "No risk signals."}{" "}
            Score computed deterministically before any AI involvement.
          </p>
        </Panel>
        <WhyRisky report={report} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <AiAssessmentPanel report={report} />
          <Panel tone="evidence" title="Detected evidence" aside={`${report.signals.length} signals`}>
            <SignalList signals={report.signals} />
          </Panel>
        </div>
        <div className="space-y-6">
          <ActionsPanel report={report} />
          <CategoryBreakdown report={report} />
          <ScoreMath report={report} />
          <ConfidencePanel report={report} />
          <RiskTrend history={history} currentId={report.id!} />
          <ProviderRuns report={report} />
          <PipelineTrace report={report} />
        </div>
      </div>
    </div>
  );
}
