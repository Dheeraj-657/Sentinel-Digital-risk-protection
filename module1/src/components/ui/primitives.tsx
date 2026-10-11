import type { ReactNode } from "react";
import type { DataOrigin, RiskLevel, Severity } from "@/lib/engine/types";
import { LEVEL_STYLE, SEVERITY_STYLE, cx } from "@/lib/ui";
import { AlertTriangle, Inbox } from "lucide-react";

export function Panel({
  title,
  aside,
  children,
  className,
  tone,
  id,
}: {
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  tone?: "evidence" | "ai" | "rec";
  id?: string;
}) {
  const toneBar = tone === "ai" ? "before:bg-ai" : tone === "rec" ? "before:bg-rec" : tone === "evidence" ? "before:bg-evidence" : "";
  return (
    <section
      id={id}
      className={cx(
        "relative min-w-0 rounded-lg border border-line bg-panel",
        tone && "before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:rounded-l-lg",
        toneBar,
        className,
      )}
    >
      {(title || aside) && (
        <header className="flex items-center justify-between gap-3 border-b border-line-soft px-5 py-3.5">
          <h2 className="text-[15px] font-semibold tracking-tight text-fg">{title}</h2>
          {aside && <div className="text-sm text-muted">{aside}</div>}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function LevelBadge({ level, size = "md" }: { level: RiskLevel; size?: "sm" | "md" | "lg" }) {
  const s = LEVEL_STYLE[level];
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border font-semibold whitespace-nowrap",
        s.text,
        s.bg,
        s.border,
        size === "sm" && "px-2 py-0.5 text-xs",
        size === "md" && "px-2.5 py-1 text-sm",
        size === "lg" && "px-3.5 py-1.5 text-base",
      )}
    >
      <span className="size-1.5 rounded-full" style={{ background: s.color }} aria-hidden />
      {s.label}
    </span>
  );
}

export function SeverityTag({ severity, impact }: { severity: Severity; impact?: number }) {
  const s = SEVERITY_STYLE[severity];
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs font-semibold", s.text, s.bg)}>
      <span className={cx("size-1.5 rounded-full", s.dot)} aria-hidden />
      {s.label}
      {impact !== undefined && <span className="font-mono font-medium opacity-90">{impact > 0 ? `+${impact}` : impact}</span>}
    </span>
  );
}

const ORIGIN_COPY: Record<DataOrigin, { label: string; title: string; cls: string }> = {
  COMPUTED: { label: "Computed", title: "Calculated directly from the submitted input", cls: "text-evidence border-line" },
  LIVE: { label: "Live data", title: "Fetched from a real external source during this scan", cls: "text-risk-verylow border-risk-verylow/40" },
  DEMO: { label: "Demo data", title: "From the curated demo threat-intel dataset", cls: "text-risk-medium border-risk-medium/40" },
};

export function OriginTag({ origin }: { origin: DataOrigin }) {
  const o = ORIGIN_COPY[origin];
  return (
    <span title={o.title} className={cx("rounded border px-1.5 py-px text-[11px] font-medium", o.cls)}>
      {o.label}
    </span>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-line px-6 py-14 text-center">
      <Inbox className="mb-3 size-7 text-faint" aria-hidden />
      <p className="font-semibold text-fg">{title}</p>
      <p className="mt-1 max-w-md text-sm text-muted">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-lg border border-risk-critical/40 bg-risk-critical/8 px-4 py-3.5">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-risk-critical" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-fg">{title}</p>
        <p className="mt-0.5 text-sm text-muted">{body}</p>
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  );
}

export function Button({
  children,
  variant = "primary",
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }) {
  return (
    <button
      {...rest}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-action text-ink hover:bg-[#8bbbea]",
        variant === "ghost" && "border border-line text-fg hover:bg-raised",
        variant === "danger" && "border border-risk-critical/40 text-risk-critical hover:bg-risk-critical/10",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Meter({ value, color, label }: { value: number; color: string; label: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-line-soft" role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }} />
    </div>
  );
}
