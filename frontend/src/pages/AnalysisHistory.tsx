import { useState } from "react";
import { Link } from "react-router-dom";
import { useApi, useEnrichment } from "../lib/hooks";
import { m2 } from "../lib/api";
import { useTenant } from "../lib/tenant";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  PageHeader,
  TableSkeleton,
} from "../components/ui";
import { JOB_STATUS_LABEL, formatDateTime } from "../lib/format";
import type { JobStatus } from "../lib/types";

const PAGE_SIZE = 25;

const STATUS_OPTIONS: Array<{ value: JobStatus | ""; label: string }> = [
  { value: "", label: "All statuses" },
  { value: "QUEUED", label: JOB_STATUS_LABEL.QUEUED },
  { value: "RUNNING", label: JOB_STATUS_LABEL.RUNNING },
  { value: "COMPLETED", label: JOB_STATUS_LABEL.COMPLETED },
  { value: "FAILED", label: JOB_STATUS_LABEL.FAILED },
  { value: "CANCELLED", label: JOB_STATUS_LABEL.CANCELLED },
];

function statusTone(status: JobStatus): "neutral" | "low" | "critical" | "ai" {
  switch (status) {
    case "COMPLETED":
      return "low";
    case "FAILED":
      return "critical";
    case "RUNNING":
      return "ai";
    default:
      return "neutral";
  }
}

export function AnalysisHistory() {
  const { tenant } = useTenant();
  const enrichment = useEnrichment();
  const [status, setStatus] = useState<JobStatus | "">("");
  const [offset, setOffset] = useState(0);

  const jobs = useApi(
    () => m2.listJobs({ status: status || undefined, limit: PAGE_SIZE, offset }, tenant),
    [tenant, status, offset],
  );

  const total = jobs.data?.total ?? 0;
  const nextOffset = offset + PAGE_SIZE;
  const hasPrev = offset > 0;
  const hasNext = nextOffset < total;

  return (
    <>
      <PageHeader
        title="Analysis history"
        description="Every Module 2 risk-engine job in this tenant — queued, running, completed, and failed. Completed jobs link to their threat records."
        actions={
          <Link to="/analysis/new">
            <Button variant="primary">Run analysis</Button>
          </Link>
        }
      />

      <Card>
        <CardHeader
          title="Job history"
          description={
            jobs.data
              ? `${total} job${total === 1 ? "" : "s"} on record — showing ${jobs.data.items.length}`
              : undefined
          }
          actions={
            <select
              aria-label="Filter by job status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as JobStatus | "");
                setOffset(0);
              }}
              className="rounded border border-line bg-ink px-2 py-1.5 text-xs text-fg focus:border-action/60 focus:outline-none"
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          }
        />

        {jobs.loading ? (
          <TableSkeleton rows={6} cols={4} />
        ) : jobs.error ? (
          <ErrorState error={jobs.error} onRetry={jobs.reload} context="analysis jobs" />
        ) : !jobs.data || jobs.data.items.length === 0 ? (
          <EmptyState
            title={status ? `No ${JOB_STATUS_LABEL[status].toLowerCase()} jobs` : "No jobs yet"}
            description={
              status
                ? "No jobs match this status — clear the filter to see the full history."
                : "Run an analysis to score a discovered entity against a protected brand."
            }
            action={
              status ? (
                <Button
                  onClick={() => {
                    setStatus("");
                    setOffset(0);
                  }}
                >
                  Clear filter
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
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-line-soft text-[11px] text-faint">
                    <th scope="col" className="px-4 py-2.5 font-medium sm:px-5">
                      Job
                    </th>
                    <th scope="col" className="px-4 py-2.5 font-medium">
                      Status
                    </th>
                    <th scope="col" className="hidden px-4 py-2.5 font-medium sm:table-cell">
                      Brand
                    </th>
                    <th scope="col" className="hidden px-4 py-2.5 font-medium sm:table-cell">
                      Entity
                    </th>
                    <th scope="col" className="hidden px-4 py-2.5 font-medium md:table-cell">
                      Created
                    </th>
                    <th scope="col" className="hidden px-4 py-2.5 font-medium lg:table-cell">
                      Threat
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {jobs.data.items.map((job) => (
                    <tr key={job.job_id} className="transition hover:bg-raised/50">
                      <td className="px-4 py-3 sm:px-5">
                        <Link
                          to={`/analysis/${job.job_id}`}
                          className="font-mono text-xs text-fg hover:text-action"
                          title={job.job_id}
                        >
                          {job.job_id.slice(0, 8)}…
                        </Link>
                        {job.error_code ? (
                          <p className="mt-0.5 text-[11px] text-risk-critical">
                            {job.error_code}
                          </p>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <Badge tone={statusTone(job.status)}>{JOB_STATUS_LABEL[job.status]}</Badge>
                      </td>
                      <td className="hidden max-w-40 truncate px-4 py-3 text-xs text-muted sm:table-cell">
                        {enrichment.brandName(job.brand_id)}
                      </td>
                      <td className="hidden max-w-40 truncate px-4 py-3 text-xs text-muted sm:table-cell">
                        {enrichment.entityName(job.entity_id)}
                      </td>
                      <td className="hidden whitespace-nowrap px-4 py-3 text-xs text-muted md:table-cell">
                        {formatDateTime(job.created_at)}
                      </td>
                      <td className="hidden whitespace-nowrap px-4 py-3 text-xs lg:table-cell">
                        {job.threat_id ? (
                          <Link
                            to={`/threats/${job.threat_id}`}
                            className="font-mono text-action hover:underline"
                            title={job.threat_id}
                          >
                            {job.threat_id.slice(0, 8)}…
                          </Link>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {hasPrev || hasNext ? (
              <div className="flex items-center justify-between gap-3 border-t border-line-soft px-4 py-3 text-xs text-muted sm:px-5">
                <span className="text-faint">
                  {offset + 1}–{Math.min(nextOffset, total)} of {total}
                </span>
                <div className="flex items-center gap-2">
                  <Button disabled={!hasPrev} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
                    Previous
                  </Button>
                  <Button disabled={!hasNext} onClick={() => setOffset(nextOffset)}>
                    Next
                  </Button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </Card>
    </>
  );
}
