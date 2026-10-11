import type { AnalysisReport } from "@/lib/engine/types";
import { CATEGORY_META } from "@/lib/engine/constants";
import { CATEGORY_COLOR, LEVEL_STYLE } from "@/lib/ui";
import { Panel } from "@/components/ui/primitives";

export function CategoryBreakdown({ report }: { report: AnalysisReport }) {
  return (
    <Panel title="Risk breakdown" aside="Points added to the score, out of each category's cap">
      <ul className="space-y-4">
        {report.categories.map((c) => (
          <li key={c.category}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium" title={CATEGORY_META[c.category].description}>
                {c.label}
              </span>
              <span className="text-sm whitespace-nowrap text-muted">
                <span className="font-semibold text-fg">{c.points}</span> / {c.cap}
                <span className="ml-2 inline-block w-11 text-right text-faint">{c.percent}%</span>
              </span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-line-soft">
              <div className="h-full rounded-full" style={{ width: `${c.percent}%`, background: CATEGORY_COLOR[c.category] }} />
            </div>
            {(c.signalCount > 0 || c.mitigationPoints > 0) && (
              <p className="mt-1 text-xs text-faint">
                {c.rawPoints > 0 && <>{c.rawPoints} risk pts</>}
                {c.mitigationPoints > 0 && <>{c.rawPoints > 0 && ", "}−{c.mitigationPoints} mitigating</>}
                {c.capped && <>, capped at {c.cap}</>}
              </p>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function ScoreMath({ report }: { report: AnalysisReport }) {
  const parts = report.categories.filter((c) => c.points > 0);
  return (
    <Panel title="How this score was calculated">
      <ol className="space-y-3 text-sm text-muted">
        <li>
          <span className="text-fg">Each signal adds fixed points</span> to its category; mitigating evidence subtracts. Each category is
          capped, and the caps add up to 100.
        </li>
        <li>
          <span className="text-fg">Base score</span> is the sum of the capped categories:
          <p className="mt-1.5 font-mono text-[13px] text-fg">
            {parts.length ? parts.map((p) => p.points).join(" + ") : "0"} = {report.baseScore}
          </p>
        </li>
        {report.scoreAdjustments.length > 0 && (
          <li>
            <span className="text-fg">Explicit floor:</span> {report.scoreAdjustments.map((a) => a.reason).join("; ")}.
          </li>
        )}
        <li>
          <span className="text-fg">Level</span> comes from fixed bands: 0–20 very low, 21–40 low, 41–60 medium, 61–80 high, 81–100 critical.
          Final score <span className="font-semibold" style={{ color: LEVEL_STYLE[report.riskLevel].color }}>{report.riskScore}</span>.
        </li>
        <li>The AI assessment is written afterwards from these results and cannot change them.</li>
      </ol>
    </Panel>
  );
}

export function ConfidencePanel({ report }: { report: AnalysisReport }) {
  return (
    <Panel title="Confidence" aside={<span className="text-fg"><span className="text-lg font-bold">{report.confidenceScore}</span>/100</span>}>
      <ul className="space-y-3">
        {report.confidenceFactors.map((f) => (
          <li key={f.key} className="text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium">{f.label}</span>
              <span className={f.points < 0 ? "text-risk-high" : "text-muted"}>
                {f.max > 0 ? (
                  <>
                    <span className="font-semibold text-fg">{f.points}</span> / {f.max}
                  </>
                ) : (
                  <span className="font-semibold">{f.points}</span>
                )}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-faint">{f.detail}</p>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
