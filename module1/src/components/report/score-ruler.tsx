import type { AnalysisReport } from "@/lib/engine/types";
import { CATEGORY_COLOR, LEVEL_STYLE } from "@/lib/ui";
import { LevelBadge } from "@/components/ui/primitives";

const BANDS = [
  { from: 0, to: 20, label: "Very low" },
  { from: 21, to: 40, label: "Low" },
  { from: 41, to: 60, label: "Medium" },
  { from: 61, to: 80, label: "High" },
  { from: 81, to: 100, label: "Critical" },
];

/**
 * The score *is* its breakdown: each coloured segment is one category's points,
 * and segment widths sum to the base score. A floor, if applied, is drawn hatched.
 */
export function ScoreRuler({ report }: { report: AnalysisReport }) {
  const lvl = LEVEL_STYLE[report.riskLevel];
  const segs = report.categories.filter((c) => c.points > 0);
  const floorGap = report.riskScore - report.baseScore;

  return (
    <div>
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="flex items-end gap-2">
          <span
            className="font-condensed text-[104px] leading-[0.82] font-extrabold tracking-tight sm:text-[128px]"
            style={{ color: lvl.color }}
            aria-label={`Risk score ${report.riskScore} out of 100`}
          >
            {report.riskScore}
          </span>
          <span className="mb-2 text-lg text-faint">/100</span>
        </div>
        <div className="mb-2 space-y-2">
          <LevelBadge level={report.riskLevel} size="lg" />
          <p className="text-sm text-muted">
            Confidence <span className="font-semibold text-fg">{report.confidenceScore}</span>/100
          </p>
        </div>
      </div>

      <div className="mt-6">
        <div className="relative h-4 w-full overflow-hidden rounded-sm bg-line-soft" aria-hidden>
          <div className="ruler-fill flex h-full">
            {segs.map((c) => (
              <div
                key={c.category}
                title={`${c.label}: ${c.points} pts`}
                className="h-full border-r-2 border-ink last:border-r-0"
                style={{ width: `${c.points}%`, background: CATEGORY_COLOR[c.category] }}
              />
            ))}
            {floorGap > 0 && (
              <div
                title={`Score floor: +${floorGap}`}
                className="h-full"
                style={{
                  width: `${floorGap}%`,
                  background: `repeating-linear-gradient(135deg, ${lvl.color} 0 4px, transparent 4px 8px)`,
                }}
              />
            )}
          </div>
          {[20, 40, 60, 80].map((t) => (
            <div key={t} className="absolute top-0 h-full w-px bg-ink/70" style={{ left: `${t}%` }} />
          ))}
        </div>
        <div className="relative mt-1.5 grid grid-cols-5 text-[11px] text-faint">
          {BANDS.map((b) => {
            const active = report.riskScore >= b.from && report.riskScore <= b.to;
            return (
              <span key={b.label} className={active ? "font-semibold" : ""} style={active ? { color: lvl.color } : undefined}>
                {b.label}
              </span>
            );
          })}
        </div>
      </div>

      {segs.length > 0 ? (
        <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {segs.map((c) => (
            <li key={c.category} className="flex items-center gap-2">
              <span className="size-2.5 rounded-sm" style={{ background: CATEGORY_COLOR[c.category] }} aria-hidden />
              <span className="text-muted">{c.label}</span>
              <span className="font-semibold">{c.points}</span>
            </li>
          ))}
          {floorGap > 0 && (
            <li className="flex items-center gap-2">
              <span
                className="size-2.5 rounded-sm"
                style={{ background: `repeating-linear-gradient(135deg, ${lvl.color} 0 2px, transparent 2px 4px)` }}
                aria-hidden
              />
              <span className="text-muted">Threat-feed floor</span>
              <span className="font-semibold">+{floorGap}</span>
            </li>
          )}
        </ul>
      ) : (
        <p className="mt-5 text-sm text-muted">No category contributed risk points.</p>
      )}
    </div>
  );
}
