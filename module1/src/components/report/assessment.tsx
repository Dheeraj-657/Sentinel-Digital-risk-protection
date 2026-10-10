import type { AnalysisReport, Signal } from "@/lib/engine/types";
import { Panel, SeverityTag } from "@/components/ui/primitives";
import { Sparkles, ShieldAlert, ShieldCheck, ListChecks } from "lucide-react";
import { cx } from "@/lib/ui";

function Cite({ id }: { id: string }) {
  return (
    <a
      href={`#signal-${id}`}
      className="rounded border border-line px-1 py-px font-mono text-[11px] text-evidence hover:border-action hover:text-fg"
      title={`Jump to evidence ${id}`}
    >
      {id}
    </a>
  );
}

/** "Why is this risky?" — straight from the top deterministic signals, no AI. */
export function WhyRisky({ report }: { report: AnalysisReport }) {
  const risky = report.signals.filter((s) => s.impact > 0).slice(0, 4);
  const mitig = report.signals.filter((s) => s.impact < 0).slice(0, 3);
  const safe = risky.length === 0;
  const list: Signal[] = safe ? mitig : risky;
  return (
    <Panel
      tone="evidence"
      title={
        <span className="flex items-center gap-2">
          {safe ? <ShieldCheck className="size-4 text-risk-verylow" aria-hidden /> : <ShieldAlert className="size-4 text-risk-high" aria-hidden />}
          {safe ? "Why this looks legitimate" : "Why is this risky?"}
        </span>
      }
      aside="Detected evidence"
    >
      {list.length === 0 ? (
        <p className="text-sm text-muted">
          No risk or mitigating signals fired. Most intelligence sources had no data for this entity; see Confidence below.
        </p>
      ) : (
        <ul className="space-y-3">
          {list.map((s) => (
            <li key={s.id} className="flex items-start gap-3">
              <SeverityTag severity={s.severity} impact={s.impact} />
              <div className="min-w-0">
                <p className="font-medium">
                  {s.title} <Cite id={s.id} />
                </p>
                <p className="mt-0.5 font-mono text-xs break-words text-faint">{s.evidence}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function AiAssessmentPanel({ report }: { report: AnalysisReport }) {
  const a = report.aiAssessment;
  const groq = a.source === "GROQ";
  return (
    <Panel
      tone="ai"
      title={
        <span className="flex items-center gap-2">
          <Sparkles className="size-4 text-ai" aria-hidden />
          AI assessment
        </span>
      }
      aside={
        <span className={cx("text-xs", groq ? "text-ai" : "text-faint")} title={a.notes.join(" ")}>
          {groq ? `Groq (${a.model})` : "Template fallback"}
        </span>
      }
    >
      <p className="leading-relaxed text-fg">{a.summary}</p>
      {a.keyFindings.length > 0 && (
        <ul className="mt-4 space-y-2.5">
          {a.keyFindings.map((f, i) => (
            <li key={i} className="flex gap-2.5 text-sm">
              <span className="mt-2 size-1 shrink-0 rounded-full bg-ai" aria-hidden />
              <span className="text-muted">
                <span className="text-fg">{f.text}</span>{" "}
                <span className="inline-flex flex-wrap gap-1 align-middle">
                  {f.signalIds.map((id) => (
                    <Cite key={id} id={id} />
                  ))}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {a.caveats.length > 0 && (
        <div className="mt-4 border-t border-line-soft pt-3">
          <p className="text-xs font-semibold text-muted">Limitations</p>
          <ul className="mt-1 space-y-1 text-xs text-faint">
            {a.caveats.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-4 text-xs text-faint">
        {groq
          ? "Written by the language model from the detected evidence only. Every finding cites its evidence; the score and actions were fixed before the model ran."
          : a.notes[0] ?? "Deterministic explanation generated from the detected evidence."}
      </p>
    </Panel>
  );
}

const PRIORITY_STYLE = {
  IMMEDIATE: "text-risk-critical border-risk-critical/40",
  HIGH: "text-risk-high border-risk-high/40",
  MEDIUM: "text-risk-medium border-risk-medium/40",
  LOW: "text-muted border-line",
} as const;

export function ActionsPanel({ report }: { report: AnalysisReport }) {
  const notes = new Map(report.aiAssessment.actionNotes.map((n) => [n.actionId, n.note]));
  return (
    <Panel
      tone="rec"
      title={
        <span className="flex items-center gap-2">
          <ListChecks className="size-4 text-rec" aria-hidden />
          Recommended actions
        </span>
      }
      aside="Recommendation"
    >
      <ol className="space-y-4">
        {report.recommendedActions.map((a) => (
          <li key={a.id} className="flex gap-3">
            <span className={cx("h-fit rounded border px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap", PRIORITY_STYLE[a.priority])}>
              {a.priority === "IMMEDIATE" ? "Now" : a.priority[0] + a.priority.slice(1).toLowerCase()}
            </span>
            <div className="min-w-0">
              <p className="font-semibold">{a.action}</p>
              <p className="mt-0.5 text-sm text-muted">{notes.get(a.id) ?? a.rationale}</p>
              {a.basedOn.length > 0 && (
                <p className="mt-1.5 flex flex-wrap items-center gap-1 text-xs text-faint">
                  Based on {a.basedOn.map((id) => <Cite key={id} id={id} />)}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
