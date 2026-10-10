import { useState } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../lib/hooks";
import { m1 } from "../lib/api";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  M1RiskLevelBadge,
  M1ScoreBar,
  PageHeader,
  TableSkeleton,
} from "../components/ui";
import { M1_ENTITY_TYPE_LABEL, M1_RISK_LEVEL_LABEL, formatDateTime } from "../lib/format";
import type { M1EntityType, M1RiskLevel } from "../lib/types";

const PAGE_SIZE = 25;

const TYPE_OPTIONS: Array<{ value: M1EntityType | ""; label: string }> = [
  { value: "", label: "All types" },
  { value: "PROFILE", label: M1_ENTITY_TYPE_LABEL.PROFILE },
  { value: "WEBSITE", label: M1_ENTITY_TYPE_LABEL.WEBSITE },
  { value: "DOMAIN", label: M1_ENTITY_TYPE_LABEL.DOMAIN },
  { value: "APP", label: M1_ENTITY_TYPE_LABEL.APP },
];

const LEVEL_OPTIONS: Array<{ value: M1RiskLevel | ""; label: string }> = [
  { value: "", label: "All levels" },
  { value: "CRITICAL", label: M1_RISK_LEVEL_LABEL.CRITICAL },
  { value: "HIGH", label: M1_RISK_LEVEL_LABEL.HIGH },
  { value: "MEDIUM", label: M1_RISK_LEVEL_LABEL.MEDIUM },
  { value: "LOW", label: M1_RISK_LEVEL_LABEL.LOW },
  { value: "VERY_LOW", label: M1_RISK_LEVEL_LABEL.VERY_LOW },
];

const filterSelect =
  "rounded border border-line bg-ink px-2 py-1.5 text-xs text-fg focus:border-action/60 focus:outline-none";

export function Scans() {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<M1EntityType | "">("");
  const [level, setLevel] = useState<M1RiskLevel | "">("");
  const [cursor, setCursor] = useState<string | undefined>(undefined);

  const scans = useApi(
    () =>
      m1.listScans({
        q: query || undefined,
        type: type || undefined,
        level: level || undefined,
        limit: PAGE_SIZE,
        cursor,
      }),
    [query, type, level, cursor],
  );

  const hasFilters = query !== "" || type !== "" || level !== "";

  const resetFilters = () => {
    setQuery("");
    setType("");
    setLevel("");
    setCursor(undefined);
  };

  return (
    <>
      <PageHeader
        title="Scans"
        description="Every entity risk scan run through the Sentinel engine, newest first. Rows link to the full report — signals, category scores, AI assessment, and recommended actions."
        actions={
          <Link to="/scan/new">
            <Button variant="primary">New scan</Button>
          </Link>
        }
      />

      <Card>
        <CardHeader
          title="Scan history"
          description={
            scans.data
              ? `${scans.data.total} scan${scans.data.total === 1 ? "" : "s"} on record — showing ${scans.data.items.length}`
              : undefined
          }
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  setCursor(undefined);
                }}
                className="flex items-center gap-2"
              >
                <label className="sr-only" htmlFor="scan-search">
                  Search scans
                </label>
                <input
                  id="scan-search"
                  type="search"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setCursor(undefined);
                  }}
                  placeholder="Search target or brand…"
                  spellCheck={false}
                  className="w-52 rounded border border-line bg-ink px-2.5 py-1.5 text-xs text-fg placeholder:text-faint focus:border-action/60 focus:outline-none"
                />
              </form>
              <select
                aria-label="Filter by entity type"
                value={type}
                onChange={(event) => {
                  setType(event.target.value as M1EntityType | "");
                  setCursor(undefined);
                }}
                className={filterSelect}
              >
                {TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <select
                aria-label="Filter by risk level"
                value={level}
                onChange={(event) => {
                  setLevel(event.target.value as M1RiskLevel | "");
                  setCursor(undefined);
                }}
                className={filterSelect}
              >
                {LEVEL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {hasFilters ? (
                <Button variant="ghost" onClick={resetFilters}>
                  Clear
                </Button>
              ) : null}
            </div>
          }
        />

        {scans.loading ? (
          <TableSkeleton rows={6} />
        ) : scans.error ? (
          <ErrorState error={scans.error} onRetry={scans.reload} context="scans" />
        ) : !scans.data || scans.data.items.length === 0 ? (
          <EmptyState
            title={hasFilters ? "No scans match the filters" : "No scans yet"}
            description={
              hasFilters
                ? "Adjust or clear the filters to see more results."
                : "Run the engine on a profile, website, domain, or app — the report lands here with its full breakdown."
            }
            action={
              hasFilters ? (
                <Button onClick={resetFilters}>Clear filters</Button>
              ) : (
                <Link to="/scan/new">
                  <Button variant="primary">New scan</Button>
                </Link>
              )
            }
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-line-soft text-[11px] text-faint">
                    <th scope="col" className="px-4 py-2.5 font-medium sm:px-5">
                      Target
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-medium">
                      Type
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-medium">
                      Risk
                    </th>
                    <th scope="col" className="hidden px-4 py-2.5 font-medium sm:table-cell">
                      Confidence
                    </th>
                    <th scope="col" className="hidden px-4 py-2.5 font-medium lg:table-cell">
                      Brand
                    </th>
                    <th scope="col" className="hidden px-4 py-2.5 font-medium md:table-cell">
                      Signals
                    </th>
                    <th scope="col" className="hidden px-4 py-2.5 font-medium md:table-cell">
                      Assessment
                    </th>
                    <th scope="col" className="hidden px-4 py-2.5 font-medium lg:table-cell">
                      When
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {scans.data.items.map((scan) => (
                    <tr key={scan.id} className="transition hover:bg-raised/50">
                      <td className="max-w-72 px-4 py-3 sm:px-5">
                        <Link
                          to={`/scans/${scan.id}`}
                          className="text-fg hover:text-action"
                          title={scan.target}
                        >
                          <span className="block truncate font-medium">
                            {scan.displayName ?? scan.target}
                          </span>
                          {scan.displayName ? (
                            <span className="block truncate font-mono text-[11px] text-faint">
                              {scan.target}
                            </span>
                          ) : null}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-muted">
                        {M1_ENTITY_TYPE_LABEL[scan.entityType] ?? scan.entityType}
                      </td>
                      <td className="w-36 px-4 py-3">
                        <div className="flex items-center gap-2">
                          <M1RiskLevelBadge level={scan.riskLevel} />
                          <span className="font-mono text-xs text-fg">{scan.riskScore}</span>
                        </div>
                        <M1ScoreBar
                          value={scan.riskScore}
                          level={scan.riskLevel}
                          className="mt-1"
                        />
                      </td>
                      <td className="hidden whitespace-nowrap px-4 py-3 font-mono text-xs text-muted sm:table-cell">
                        {scan.confidenceScore}
                      </td>
                      <td className="hidden max-w-40 truncate px-4 py-3 text-xs text-muted lg:table-cell">
                        {scan.brandName ?? "—"}
                      </td>
                      <td className="hidden whitespace-nowrap px-4 py-3 text-xs text-muted md:table-cell">
                        {scan.signalCount}
                      </td>
                      <td className="hidden whitespace-nowrap px-4 py-3 md:table-cell">
                        {scan.aiSource === "GROQ" ? (
                          <Badge tone="ai">Groq LLM</Badge>
                        ) : (
                          <Badge>Fallback</Badge>
                        )}
                      </td>
                      <td className="hidden whitespace-nowrap px-4 py-3 text-xs text-muted lg:table-cell">
                        {formatDateTime(scan.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-soft px-4 py-3 text-xs text-muted sm:px-5">
              {cursor ? (
                <span className="text-faint">
                  Page {Math.floor((scans.data.total - scans.data.items.length) / PAGE_SIZE) + 1}
                  {" "}— cursor pagination, jump back to the first page to retrace.
                </span>
              ) : (
                <span className="text-faint">Newest first</span>
              )}
              <div className="flex items-center gap-2">
                {cursor ? (
                  <Button onClick={() => setCursor(undefined)}>Back to start</Button>
                ) : null}
                <Button
                  onClick={() => scans.data?.nextCursor && setCursor(scans.data.nextCursor)}
                  disabled={!scans.data?.nextCursor}
                >
                  Next page
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </>
  );
}
