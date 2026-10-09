"use client";
import { useState } from "react";
import type { RiskCategory, Signal } from "@/lib/engine/types";
import { CATEGORY_META } from "@/lib/engine/constants";
import { CATEGORY_COLOR, cx } from "@/lib/ui";
import { OriginTag, SeverityTag } from "@/components/ui/primitives";

export function SignalCard({ s }: { s: Signal }) {
  return (
    <li id={`signal-${s.id}`} className="scroll-mt-24 rounded-md border border-line-soft bg-ink/40 p-4 target:border-action target:bg-action/5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-faint">{s.id}</span>
        <SeverityTag severity={s.severity} impact={s.impact} />
        <span className="flex items-center gap-1.5 text-xs text-muted">
          <span className="size-2 rounded-sm" style={{ background: CATEGORY_COLOR[s.category] }} aria-hidden />
          {CATEGORY_META[s.category].label}
        </span>
      </div>
      <p className="mt-2 font-semibold">{s.title}</p>
      <p className="mt-1 text-sm text-muted">{s.description}</p>
      <div className="mt-3 rounded border border-line-soft bg-ink px-3 py-2">
        <p className="mb-1 text-[11px] text-faint">Observed</p>
        <p className="font-mono text-[12.5px] leading-relaxed break-words text-evidence">{s.evidence}</p>
      </div>
      <p className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-faint">
        Source: {s.provider} <OriginTag origin={s.origin} />
      </p>
    </li>
  );
}

export function SignalList({ signals }: { signals: Signal[] }) {
  const [filter, setFilter] = useState<RiskCategory | "ALL">("ALL");
  const risk = signals.filter((s) => s.impact > 0);
  const mitig = signals.filter((s) => s.impact <= 0);
  const cats = [...new Set(risk.map((s) => s.category))];
  const shown = filter === "ALL" ? risk : risk.filter((s) => s.category === filter);

  return (
    <div>
      {cats.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-1.5" role="group" aria-label="Filter signals by category">
          {(["ALL", ...cats] as const).map((c) => (
            <button
              key={c}
              onClick={() => setFilter(c)}
              aria-pressed={filter === c}
              className={cx(
                "rounded-full border px-2.5 py-1 text-xs transition-colors",
                filter === c ? "border-action bg-action/15 text-fg" : "border-line text-muted hover:text-fg",
              )}
            >
              {c === "ALL" ? `All (${risk.length})` : `${CATEGORY_META[c].label} (${risk.filter((s) => s.category === c).length})`}
            </button>
          ))}
        </div>
      )}
      {risk.length === 0 ? (
        <p className="rounded-md border border-dashed border-line px-4 py-6 text-center text-sm text-muted">
          No risk signals fired for this entity.
        </p>
      ) : (
        <ul className="space-y-3">
          {shown.map((s) => (
            <SignalCard key={s.id} s={s} />
          ))}
        </ul>
      )}
      {mitig.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-3 text-sm font-semibold text-risk-verylow">Mitigating evidence</h3>
          <ul className="space-y-3">
            {mitig.map((s) => (
              <SignalCard key={s.id} s={s} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
