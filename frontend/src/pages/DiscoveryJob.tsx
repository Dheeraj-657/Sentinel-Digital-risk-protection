import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { m2 } from "../lib/api";
import { useTenant } from "../lib/tenant";
import { useEnrichment, errorMessage } from "../lib/hooks";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  KeyValue,
  PageHeader,
} from "../components/ui";
import {
  DISCOVERY_JOB_STATUS_LABEL,
  DISCOVERY_JOB_STATUS_TONE,
  DISCOVERY_PROVIDER_STATUS_LABEL,
  DISCOVERY_PROVIDER_STATUS_TONE,
  ENTITY_TYPE_LABEL,
  formatDateTime,
} from "../lib/format";
import type { DiscoveryJob } from "../lib/types";

const POLL_MS = 1500;
const TIMEOUT_MS = 300_000;

const TERMINAL = ["COMPLETED", "PARTIAL", "FAILED"];

export function DiscoveryJob() {
  const { jobId = "" } = useParams();
  const { tenant } = useTenant();
  const { brandName } = useEnrichment();
  const [job, setJob] = useState<DiscoveryJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const startedRef = useRef(Date.now());

  const refresh = useCallback(async () => {
    try {
      const next = await m2.getDiscovery(jobId, tenant);
      setJob(next);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [jobId, tenant]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = startedRef.current;

    const tick = async () => {
      if (cancelled) return;
      await refresh();
      if (cancelled) return;
      setJob((current) => {
        if (current && TERMINAL.includes(current.status)) return current;
        if (Date.now() - started > TIMEOUT_MS) {
          setTimedOut(true);
          return current;
        }
        timer = setTimeout(tick, POLL_MS);
        return current;
      });
    };

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [refresh]);

  const terminal = job !== null && TERMINAL.includes(job.status);
  const waiting = !terminal && !timedOut && !error;

  return (
    <>
      <PageHeader
        title="Threat discovery run"
        description="Automatic candidate discovery from brand DNA: observable provider coverage, deduplicated candidates, and the evidence/analysis chain for every observation. Candidates are observations from public sources — not verdicts."
        actions={
          job ? (
            <Link to={`/brands/${job.brand_id}`}>
              <Button>Back to brand</Button>
            </Link>
          ) : undefined
        }
      />

      <Card className="px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-fg">Job {jobId}</h2>
            {job ? (
              <Badge tone={DISCOVERY_JOB_STATUS_TONE[job.status]}>
                {DISCOVERY_JOB_STATUS_LABEL[job.status]}
              </Badge>
            ) : null}
          </div>
          {waiting ? (
            <span className="flex items-center gap-2 text-xs text-muted" aria-live="polite">
              <span className="size-1.5 animate-pulse rounded-full bg-ai" aria-hidden />
              {job?.status === "RUNNING" ? "Querying providers…" : "Waiting for a worker…"}
            </span>
          ) : null}
        </div>

        {error ? (
          <div role="alert" className="mt-4 space-y-3">
            <p className="text-xs leading-relaxed text-risk-medium">{error}</p>
            <Button onClick={refresh}>Retry</Button>
          </div>
        ) : null}

        {timedOut && !terminal ? (
          <div role="alert" className="mt-4 space-y-2">
            <p className="text-xs leading-relaxed text-risk-medium">
              Still running after {Math.round(TIMEOUT_MS / 1000)}s — this page stopped polling. The
              job continues server-side; check the provider outcomes below once it lands.
            </p>
            <Button
              onClick={() => {
                setTimedOut(false);
                startedRef.current = Date.now();
                refresh();
              }}
            >
              Keep polling
            </Button>
          </div>
        ) : null}

        {job ? (
          <>
            {job.status === "FAILED" ? (
              <div role="alert" className="mt-4 rounded border border-risk-critical/40 bg-risk-critical/10 px-4 py-3">
                <p className="font-mono text-xs text-risk-critical">{job.error_code ?? "FAILED"}</p>
                <p className="mt-1 text-xs leading-relaxed text-risk-critical">
                  {job.error_message ?? "The discovery run failed — no provider reported success."}
                </p>
              </div>
            ) : job.warning_message ? (
              <div
                role="status"
                className="mt-4 rounded border border-risk-medium/40 bg-risk-medium/10 px-4 py-3"
              >
                <p className="text-xs leading-relaxed text-risk-medium">{job.warning_message}</p>
              </div>
            ) : null}

            <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-line-soft pt-4 sm:grid-cols-4">
              <KeyValue label="Brand">
                <Link to={`/brands/${job.brand_id}`} className="text-action hover:underline">
                  {brandName(job.brand_id)}
                </Link>
              </KeyValue>
              <KeyValue label="Candidates" mono>
                {job.candidates.length}
              </KeyValue>
              <KeyValue label="Duplicates skipped" mono>
                {job.duplicate_count}
              </KeyValue>
              <KeyValue label="Created" mono>
                {formatDateTime(job.created_at)}
              </KeyValue>
              <KeyValue label="Started" mono>
                {formatDateTime(job.started_at)}
              </KeyValue>
              <KeyValue label="Completed" mono>
                {formatDateTime(job.completed_at)}
              </KeyValue>
            </dl>
          </>
        ) : null}
      </Card>

      {job ? (
        <>
          <Card className="mt-4">
            <CardHeader
              title="Provider coverage"
              description="Every configured provider's outcome — including the ones that returned nothing, are unconfigured, or failed. Failures are never hidden."
            />
            {job.provider_outcomes.length === 0 ? (
              <EmptyState
                title="No provider outcomes"
                description="The run ended before any provider reported an outcome."
              />
            ) : (
              <ul className="divide-y divide-line-soft">
                {job.provider_outcomes.map((outcome) => (
                  <li
                    key={outcome.provider}
                    className="flex flex-wrap items-start justify-between gap-3 px-4 py-3.5 sm:px-5"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-fg">{outcome.provider}</p>
                        <Badge tone={DISCOVERY_PROVIDER_STATUS_TONE[outcome.status]}>
                          {DISCOVERY_PROVIDER_STATUS_LABEL[outcome.status]}
                        </Badge>
                        <span className="font-mono text-xs text-muted">
                          {outcome.candidate_count} candidate
                          {outcome.candidate_count === 1 ? "" : "s"}
                        </span>
                        {outcome.latency_ms !== null ? (
                          <span className="font-mono text-[11px] text-faint">
                            {outcome.latency_ms} ms
                          </span>
                        ) : null}
                      </div>
                      {outcome.warning ? (
                        <p className="text-xs leading-relaxed text-risk-medium">{outcome.warning}</p>
                      ) : null}
                      {outcome.error ? (
                        <p className="text-xs leading-relaxed text-risk-critical" role="alert">
                          {outcome.error}
                        </p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="mt-4">
            <CardHeader
              title="Bounded queries from brand DNA"
              description="Each query was derived from a specific brand signal — no indiscriminate crawling."
            />
            {job.queries.length === 0 ? (
              <EmptyState
                title="No queries issued"
                description="This brand's DNA produced no search terms — add official domains or keywords."
              />
            ) : (
              <ul className="divide-y divide-line-soft">
                {job.queries.map((query, index) => (
                  <li
                    key={`${query.provider}-${query.term}-${index}`}
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 sm:px-5"
                  >
                    <span className="font-mono text-xs text-fg">{query.term}</span>
                    <span className="text-[11px] uppercase tracking-widest text-faint">
                      {query.provider}
                    </span>
                    <span className="text-[11px] text-muted">basis: {query.basis}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="mt-4">
            <CardHeader
              title={`Candidates (${job.candidates.length})`}
              description="Deduplicated observations. Each links to its stored evidence and the chained canonical analysis — follow the chain before drawing conclusions."
            />
            {job.candidates.length === 0 ? (
              <EmptyState
                title="No candidates discovered"
                description={
                  job.status === "COMPLETED"
                    ? "Providers ran successfully but observed nothing matching this brand's DNA."
                    : "No candidate survived normalization for this run."
                }
              />
            ) : (
              <ul className="divide-y divide-line-soft">
                {job.candidates.map((candidate, index) => (
                  <CandidateRow key={index} candidate={candidate} />
                ))}
              </ul>
            )}
          </Card>
        </>
      ) : null}
    </>
  );
}

function CandidateRow({ candidate }: { candidate: DiscoveryJob["candidates"][number] }) {
  const label = candidate.title ?? candidate.domain ?? candidate.url ?? "Unnamed observation";
  return (
    <li className="space-y-2 px-4 py-3.5 sm:px-5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 break-words text-sm font-medium text-fg">{label}</p>
        <Badge tone="neutral">{ENTITY_TYPE_LABEL[candidate.kind] ?? candidate.kind}</Badge>
      </div>
      {candidate.url ? (
        <p className="break-all font-mono text-[11px] text-muted">{candidate.url}</p>
      ) : null}
      <dl className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-muted">
        <div className="flex gap-1.5">
          <dt className="text-faint">observed via</dt>
          <dd>{candidate.providers.join(", ")}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-faint">basis</dt>
          <dd>{candidate.query_basis}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-faint">observed at</dt>
          <dd className="font-mono">{formatDateTime(candidate.observed_at)}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-faint">fingerprint</dt>
          <dd className="font-mono">{candidate.discovery_fingerprint ?? "—"}</dd>
        </div>
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        {candidate.entity_id ? (
          <Link
            to={`/entities/${candidate.entity_id}`}
            className="rounded border border-line bg-raised px-2.5 py-1 text-[11px] font-medium text-fg transition hover:border-action/60"
          >
            Entity &amp; evidence →
          </Link>
        ) : (
          <span className="text-[11px] text-faint">no entity stored</span>
        )}
        {candidate.analysis_job_id ? (
          <Link
            to={`/analysis/${candidate.analysis_job_id}`}
            className="rounded border border-line bg-raised px-2.5 py-1 text-[11px] font-medium text-fg transition hover:border-action/60"
          >
            Analysis {candidate.analysis_status ? `(${candidate.analysis_status})` : ""} →
          </Link>
        ) : (
          <span className="text-[11px] text-faint">not scored yet</span>
        )}
      </div>
    </li>
  );
}
