import { cx, RISK_LEVEL_BAR, RISK_LEVEL_CLASS, RISK_LEVEL_LABEL } from "../lib/format";
import type { RiskLevel } from "../lib/types";
import { errorMessage } from "../lib/hooks";

export function Card({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("rounded-md border border-line-soft bg-panel", className)}>
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  description,
  actions,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line-soft px-4 py-3 sm:px-5">
      <div>
        <h2 className="text-sm font-semibold tracking-wide text-fg">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}

type BadgeTone =
  | "neutral"
  | "low"
  | "medium"
  | "high"
  | "critical"
  | "ai"
  | "evidence"
  | "action";

const BADGE_TONE: Record<BadgeTone, string> = {
  neutral: "border-line bg-raised text-muted",
  low: "border-risk-low/40 bg-risk-low/10 text-risk-low",
  medium: "border-risk-medium/40 bg-risk-medium/10 text-risk-medium",
  high: "border-risk-high/40 bg-risk-high/10 text-risk-high",
  critical: "border-risk-critical/40 bg-risk-critical/10 text-risk-critical",
  ai: "border-ai/40 bg-ai/10 text-ai",
  evidence: "border-evidence/40 bg-evidence/10 text-evidence",
  action: "border-action/40 bg-action/10 text-action",
};

export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: BadgeTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] font-medium",
        BADGE_TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function RiskLevelBadge({ level }: { level: RiskLevel }) {
  return (
    <Badge tone={level.toLowerCase() as BadgeTone}>{RISK_LEVEL_LABEL[level]}</Badge>
  );
}

/** Large risk-score readout, colored by level. */
export function RiskScore({
  score,
  level,
  size = "md",
}: {
  score: number;
  level: RiskLevel;
  size?: "md" | "lg";
}) {
  return (
    <div className="flex flex-col items-center">
      <span
        className={cx(
          "font-condensed font-mono font-bold leading-none",
          RISK_LEVEL_CLASS[level],
          size === "lg" ? "text-6xl" : "text-3xl",
        )}
      >
        {Math.round(score)}
      </span>
      <span
        className={cx(
          "mt-1 text-[11px] font-semibold uppercase tracking-widest",
          RISK_LEVEL_CLASS[level],
        )}
      >
        {RISK_LEVEL_LABEL[level]}
      </span>
    </div>
  );
}

/** Horizontal 0–100 factor bar. */
export function ScoreBar({
  value,
  level,
  className,
}: {
  value: number;
  level: RiskLevel;
  className?: string;
}) {
  return (
    <div
      className={cx("h-1.5 w-full overflow-hidden rounded bg-raised", className)}
      role="meter"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cx("h-full rounded", RISK_LEVEL_BAR[level])}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded bg-raised", className)} />;
}

export function TableSkeleton({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="divide-y divide-line-soft" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, row) => (
        <div key={row} className="flex items-center gap-4 px-4 py-3 sm:px-5">
          {Array.from({ length: cols }).map((__, col) => (
            <Skeleton
              key={col}
              className={cx("h-4", col === 0 ? "w-16" : col === cols - 1 ? "ml-auto w-24" : "w-28")}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <p className="text-sm font-semibold text-fg">{title}</p>
      {description ? <p className="max-w-md text-xs leading-relaxed text-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
  context,
}: {
  error: unknown;
  onRetry?: () => void;
  context?: string;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center"
      role="alert"
    >
      <p className="text-sm font-semibold text-fg">
        {context ? `Could not load ${context}` : "Something went wrong"}
      </p>
      <p className="max-w-md text-xs leading-relaxed text-muted">{errorMessage(error)}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 rounded border border-line bg-raised px-3 py-1.5 text-xs font-medium text-fg transition hover:border-action/60 hover:text-fg"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function Button({
  children,
  variant = "default",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "danger" | "ghost";
}) {
  const styles: Record<string, string> = {
    default: "border-line bg-raised text-fg hover:border-action/60",
    primary: "border-action/60 bg-action/15 text-action hover:bg-action/25",
    danger: "border-risk-critical/50 bg-risk-critical/10 text-risk-critical hover:bg-risk-critical/20",
    ghost: "border-transparent bg-transparent text-muted hover:text-fg",
  };
  return (
    <button
      type="button"
      className={cx(
        "inline-flex items-center gap-1.5 rounded border px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
        styles[variant],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-fg">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: "neutral" | "low" | "medium" | "high" | "critical";
}) {
  const valueClass: Record<string, string> = {
    neutral: "text-fg",
    low: "text-risk-low",
    medium: "text-risk-medium",
    high: "text-risk-high",
    critical: "text-risk-critical",
  };
  return (
    <Card className="px-4 py-3.5">
      <p className="text-[11px] font-medium uppercase tracking-widest text-faint">{label}</p>
      <p className={cx("mt-1.5 font-condensed font-mono text-3xl font-bold leading-none", valueClass[tone])}>
        {value}
      </p>
      {hint ? <p className="mt-1.5 text-[11px] text-muted">{hint}</p> : null}
    </Card>
  );
}

export function KeyValue({
  label,
  children,
  mono = false,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-[11px] font-medium uppercase tracking-widest text-faint">{label}</dt>
      <dd className={cx("text-sm text-fg", mono && "font-mono text-xs break-all")}>{children}</dd>
    </div>
  );
}

export function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded border border-line bg-raised px-2 py-0.5 font-mono text-[11px] text-muted">
      {children}
    </span>
  );
}
