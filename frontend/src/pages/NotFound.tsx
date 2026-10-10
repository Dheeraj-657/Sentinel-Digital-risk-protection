import { Link } from "react-router-dom";
import { Card } from "../components/ui";

export function NotFound() {
  return (
    <Card>
      <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
        <p className="font-condensed font-mono text-5xl font-bold text-faint">404</p>
        <p className="text-sm font-semibold text-fg">This page doesn't exist</p>
        <p className="max-w-md text-xs leading-relaxed text-muted">
          The link may be stale — a record could have been deleted, or the URL mistyped.
        </p>
        <Link
          to="/"
          className="mt-2 rounded border border-action/60 bg-action/15 px-3 py-1.5 text-xs font-semibold text-action transition hover:bg-action/25"
        >
          Back to overview
        </Link>
      </div>
    </Card>
  );
}
