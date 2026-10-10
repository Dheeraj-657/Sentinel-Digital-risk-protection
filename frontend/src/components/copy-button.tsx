import { useEffect, useRef, useState } from "react";
import { cx } from "../lib/format";

/** Copies an identifier or URL as plain text. Never opens the value. */
export function CopyButton({ value, label, className }: { value: string; label: string; className?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 1600);
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy ${label}`}
      title={`Copy ${label}`}
      className={cx(
        "inline-flex shrink-0 items-center gap-1 rounded border border-line px-1.5 py-0.5 text-[11px] text-muted transition hover:border-action/60 hover:text-fg",
        className,
      )}
    >
      {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy"}
      <span className="sr-only" aria-live="polite">
        {state === "copied" ? `${label} copied` : ""}
      </span>
    </button>
  );
}
