import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useApi } from "../lib/hooks";
import { m2 } from "../lib/api";
import { useTenant } from "../lib/tenant";
import { Button, Card, CardHeader, EmptyState, ErrorState, PageHeader, TableSkeleton } from "../components/ui";
import { ThreatTable } from "../components/threat-table";
import { cx } from "../lib/format";
import type { RiskLevel, ThreatStatus } from "../lib/types";

const PAGE_SIZE = 25;

const STATUS_OPTIONS: Array<{ value: ThreatStatus | ""; label: string }> = [
  { value: "", label: "All statuses" },
  { value: "OPEN", label: "Open" },
  { value: "CONFIRMED", label: "Confirmed" },
  { value: "DISMISSED", label: "Dismissed" },
];

const LEVEL_OPTIONS: Array<{ value: RiskLevel | ""; label: string }> = [
  { value: "", label: "All levels" },
  { value: "CRITICAL", label: "Critical" },
  { value: "HIGH", label: "High" },
  { value: "MEDIUM", label: "Medium" },
  { value: "LOW", label: "Low" },
];

type SortKey = "risk" | "recent";

/** Filters live in the URL so back-navigation from a threat detail page
 * restores the exact filtered view the analyst came from. */
export function Threats() {
  const { tenant } = useTenant();
  const [searchParams, setSearchParams] = useSearchParams();
  const [page, setPage] = useState(0);

  const statusParam = searchParams.get("status");
  const status: ThreatStatus | "" = STATUS_OPTIONS.some(
    (option) => option.value !== "" && option.value === statusParam,
  )
    ? (statusParam as ThreatStatus)
    : "";
  const levelParam = searchParams.get("level");
  const riskLevel: RiskLevel | "" = LEVEL_OPTIONS.some(
    (option) => option.value !== "" && option.value === levelParam,
  )
    ? (levelParam as RiskLevel)
    : "";
  const search = searchParams.get("q") ?? "";
  const sort: SortKey = searchParams.get("sort") === "recent" ? "recent" : "risk";

  const applyParams = (updates: Record<string, string | null>, resetPage = true) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(updates)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setSearchParams(next, { replace: true });
    if (resetPage) setPage(0);
  };

  const threats = useApi(
    () =>
      m2.listThreats(
        { status: status || undefined, risk_level: riskLevel || undefined, limit: 200 },
        tenant,
      ),
    [tenant, status, riskLevel],
  );

  const items = threats.data?.items ?? [];

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const matched = term
      ? items.filter(
          (threat) =>
            threat.entity_id.toLowerCase().includes(term) ||
            threat.brand_id.toLowerCase().includes(term) ||
            threat.threat_id.toLowerCase().includes(term) ||
            threat.classification.toLowerCase().includes(term),
        )
      : items;
    const sorted = [...matched];
    if (sort === "risk") {
      sorted.sort((a, b) => b.risk_score - a.risk_score);
    } else {
      sorted.sort((a, b) => b.analysis_timestamp.localeCompare(a.analysis_timestamp));
    }
    return sorted;
  }, [items, search, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageItems = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const hasFilters = status !== "" || riskLevel !== "" || search.trim() !== "";

  return (
    <>
      <PageHeader
        title="Threats"
        description="Confirmed and suspected brand-impersonation threats scored by the Module 2 risk engine. Rows link to the full scoring breakdown and evidence."
        actions={
          <Link to="/analysis/new">
            <Button variant="primary">Run analysis</Button>
          </Link>
        }
      />

      <Card>
        <CardHeader
          title="Threat register"
          description={
            threats.data
              ? `${threats.data.total} threat${threats.data.total === 1 ? "" : "s"} on record — showing ${filtered.length} after filters`
              : undefined
          }
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor="threat-search">
                Search threats
              </label>
              <input
                id="threat-search"
                type="search"
                value={search}
                onChange={(event) => applyParams({ q: event.target.value || null })}
                placeholder="Search ID, classification…"
                spellCheck={false}
                className="w-52 rounded border border-line bg-ink px-2.5 py-1.5 text-xs text-fg placeholder:text-faint focus:border-action/60 focus:outline-none"
              />
              <select
                aria-label="Filter by status"
                value={status}
                onChange={(event) => applyParams({ status: event.target.value || null })}
                className="rounded border border-line bg-ink px-2 py-1.5 text-xs text-fg focus:border-action/60 focus:outline-none"
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <select
                aria-label="Filter by risk level"
                value={riskLevel}
                onChange={(event) => applyParams({ level: event.target.value || null })}
                className="rounded border border-line bg-ink px-2 py-1.5 text-xs text-fg focus:border-action/60 focus:outline-none"
              >
                {LEVEL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {hasFilters ? (
                <Button
                  variant="ghost"
                  onClick={() => applyParams({ status: null, level: null, q: null })}
                >
                  Clear
                </Button>
              ) : null}
            </div>
          }
        />

        {threats.loading ? (
          <TableSkeleton rows={6} />
        ) : threats.error ? (
          <ErrorState error={threats.error} onRetry={threats.reload} context="threats" />
        ) : filtered.length === 0 ? (
          <EmptyState
            title={hasFilters ? "No threats match the filters" : "No threats recorded yet"}
            description={
              hasFilters
                ? "Adjust or clear the filters to see more results."
                : "Run an analysis to score a discovered entity and produce the first threat record."
            }
            action={
              hasFilters ? (
                <Button onClick={() => applyParams({ status: null, level: null, q: null })}>
                  Clear filters
                </Button>
              ) : (
                <Link to="/analysis/new">
                  <Button variant="primary">Run analysis</Button>
                </Link>
              )
            }
          />
        ) : (
          <>
            <ThreatTable threats={pageItems} />
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-soft px-4 py-3 text-xs text-muted sm:px-5">
              <div className="flex items-center gap-2">
                <span>Sort</span>
                <select
                  aria-label="Sort threats"
                  value={sort}
                  onChange={(event) =>
                    applyParams({ sort: event.target.value === "risk" ? null : event.target.value }, false)
                  }
                  className="rounded border border-line bg-ink px-2 py-1 text-xs text-fg focus:border-action/60 focus:outline-none"
                >
                  <option value="risk">Highest risk</option>
                  <option value="recent">Most recent</option>
                </select>
              </div>
              {pageCount > 1 ? (
                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={safePage === 0}
                  >
                    Previous
                  </Button>
                  <span className="font-mono">
                    {safePage + 1} / {pageCount}
                  </span>
                  <Button
                    onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                    disabled={safePage >= pageCount - 1}
                  >
                    Next
                  </Button>
                </div>
              ) : (
                <span className={cx("text-faint")}>Showing all {filtered.length}</span>
              )}
            </div>
          </>
        )}
      </Card>
    </>
  );
}
