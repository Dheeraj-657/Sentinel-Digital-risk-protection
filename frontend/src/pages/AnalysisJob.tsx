import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { m2 } from "../lib/api";
import { useTenant } from "../lib/tenant";
import { errorMessage } from "../lib/hooks";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  KeyValue,
  PageHeader,
  RiskLevelBadge,
  RiskScore,
} from "../components/ui";
import { CLASSIFICATION_LABEL, cx, formatDateTime, pct } from "../lib/format";
import type { AnalysisJob } from "../lib/types";

const POLL_MS = 1500;
const TIMEOUT_MS = 120_000;

const JOB_TONE: Record<string, "low" | "medium" | "ai" | "neutral" | "critical"> = {
  QUEUED: "neutral",
  RUNNING: "ai",
  COMPLETED: "low",
  FAILED: "critical",
  CANCELLED: "neutral",
};

export function AnalysisJob() {
  const { jobId = "" } = useParams();
  const { tenant } = useTenant();
  const [job, setJob] = useState<AnalysisJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const startedRef = useRef(Date.now());

  const refresh = useCallback(async () => {
    try {
      const next = await m2.getAnalysis(jobId, tenant);
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
        if (current && (current.status === "COMPLETED" || current.status === "FAILED" || current.status === "CANCELLED")) {
          return current;
        }
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

  const terminal =
    job !== null && ["COMPLETED", "FAILED", "CANCELLED"].includes(job.status);
  const waiting = !terminal && !timedOut && !error;

  return (
    <>
      <PageHeader
        title="Analysis job"
        description="Live status of the risk-engine run. This page polls the job until it completes."
        actions={
          <Link to="/threats">
            <Button>Threat register</Button>
          </Link>
        }
      />

      <Card className="px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-fg">Job {jobId}</h2>
            {job ? <Badge tone={JOB_TONE[job.status] ?? "neutral"}>{job.status}</Badge> : null}
          </div>
          {waiting ? (
            <span className="flex items-center gap-2 text-xs text-muted" aria-live="polite">
              <span className="size-1.5 animate-pulse rounded-full bg-ai" aria-hidden />
              {job?.status === "RUNNING" ? "Scoring evidence…" : "Waiting for the engine…"}
            </span>
          ) : null}
        </div>

        {error ? (
          <div role="alert" className="mt-4 space-y-3">
            <p className="text-xs leading-relaxed text-risk-medium">{error}</p>
            <div className="flex gap-2">
              <Button onClick={refresh}>Retry</Button>
              <Link to="/analysis/new">
                <Button>Start a new analysis</Button>
              </Link>
            </div>
          </div>
        ) : null}

        {timedOut && !terminal ? (
          <div role="alert" className="mt-4 space-y-2">
            <p className="text-xs leading-relaxed text-risk-medium">
              Still running after {Math.round(TIMEOUT_MS / 1000)}s — the page stopped polling. The
              job continues server-side.
            </p>
            <div className="flex gap-2">
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
          </div>
        ) : null}

        {job ? (
          <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-line-soft pt-4 sm:grid-cols-4">
            <KeyValue label="Brand" mono>
              {job.brand_id}
            </KeyValue>
            <KeyValue label="Entity" mono>
              <Link to={`/entities/${job.entity_id}`} className="text-action hover:underline">
                {job.entity_id}
              </Link>
            </KeyValue>
            <KeyValue label="Created" mono>
              {formatDateTime(job.created_at)}
            </KeyValue>
            <KeyValue label="Completed" mono>
              {formatDateTime(job.completed_at)}
            </KeyValue>
          </dl>
        ) : null}
      </Card>

      {job?.status === "FAILED" ? (
        <Card className="mt-4">
          <CardHeader title="Job failed" description="The engine reported an error for this run." />
          <div className="space-y-1 px-4 py-4 sm:px-5">
            <p className="font-mono text-sm text-risk-critical">{job.error_code ?? "UNKNOWN"}</p>
            <p className="text-xs leading-relaxed text-muted">{job.error_message ?? "No detail provided."}</p>
            <div className="pt-2">
              <Link to="/analysis/new">
                <Button>Start a new analysis</Button>
              </Link>
            </div>
          </div>
        </Card>
      ) : null}

      {job?.status === "CANCELLED" ? (
        <Card className="mt-4">
          <CardHeader title="Job cancelled" />
          <div className="px-4 py-4 text-xs text-muted sm:px-5">
            This run was cancelled before completing.
          </div>
        </Card>
      ) : null}

      {job?.status === "COMPLETED" && job.result ? (
        <>
          <Card className="mt-4 px-4 py-5 sm:px-5">
            <div className="flex flex-wrap items-center justify-between gap-5">
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-bold tracking-tight text-fg">
                    {CLASSIFICATION_LABEL[job.result.classification]}
                  </h2>
                  <RiskLevelBadge level={job.result.risk_level} />
                </div>
                <p className="text-xs text-muted">
                  Confidence {pct(job.result.confidence)} · {job.result.evidence_count} evidence
                  citation{job.result.evidence_count === 1 ? "" : "s"} across factor
                  famil{job.result.evidence_count === 1 ? "y" : "ies"} (an item counts once per
                  factor it fed)
                </p>
                <Link to={`/threats/${job.result.threat_id}`}>
                  <Button variant="primary">View threat detail</Button>
                </Link>
              </div>
              <RiskScore score={job.result.risk_score} level={job.result.risk_level} size="lg" />
            </div>
          </Card>

          <Card className="mt-4">
            <CardHeader title="Result summary" />
            <dl className="grid grid-cols-2 gap-4 px-4 py-4 sm:grid-cols-4 sm:px-5">
              <KeyValue label="Threat" mono>
                <Link to={`/threats/${job.result.threat_id}`} className="text-action hover:underline">
                  {job.result.threat_id}
                </Link>
              </KeyValue>
              <KeyValue label="Result" mono>
                {job.result.result_id}
              </KeyValue>
              <KeyValue label="Risk score" mono>
                {Math.round(job.result.risk_score)} / 100
              </KeyValue>
              <KeyValue label="Analyzed at" mono>
                {formatDateTime(job.result.analysis_timestamp)}
              </KeyValue>
            </dl>
          </Card>
        </>
      ) : null}

      {job?.status === "COMPLETED" && !job.result ? (
        <Card className="mt-4">
          <CardHeader title="No result attached" />
          <p className="px-4 py-4 text-xs text-muted sm:px-5">
            The job completed but returned no threat record.{" "}
            <Link to="/threats" className={cx("text-action hover:underline")}>
              Check the threat register
            </Link>
            .
          </p>
        </Card>
      ) : null}
    </>
  );
}
