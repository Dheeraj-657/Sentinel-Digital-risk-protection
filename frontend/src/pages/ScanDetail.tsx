import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useApi, errorMessage } from "../lib/hooks";
import { m1 } from "../lib/api";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Chip,
  EmptyState,
  ErrorState,
  KeyValue,
  M1RiskLevelBadge,
  M1RiskScore,
  M1ScoreBar,
  PageHeader,
  Skeleton,
} from "../components/ui";
import {
  M1_CATEGORY_LABEL,
  M1_ENTITY_TYPE_LABEL,
  M1_ORIGIN_LABEL,
  M1_PRIORITY_LABEL,
  M1_SEVERITY_LABEL,
  formatDateTime,
} from "../lib/format";
import type { M1RiskLevel, M1ScanDetail, M1Severity } from "../lib/types";

const SEVERITY_TONE: Record<M1Severity, "neutral" | "low" | "medium" | "high" | "critical"> = {
  INFO: "neutral",
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  CRITICAL: "critical",
};

const PRIORITY_TONE: Record<string, "neutral" | "low" | "medium" | "high" | "critical"> = {
  IMMEDIATE: "critical",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "neutral",
};

export function ScanDetail() {
  const { scanId } = useParams<{ scanId: string }>();
  const navigate = useNavigate();
  const scan = useApi(() => (scanId ? m1.getScan(scanId) : Promise.resolve(null)), [scanId]);

  const [busy, setBusy] = useState<"rescan" | "delete" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const rescan = async () => {
    if (!scan.data) return;
    const report = scan.data.report;
    setBusy("rescan");
    setActionError(null);
    try {
      const created = await m1.createScan({
        entityType: report.entity.type,
        input: report.entity.input,
        ...(report.entity.claimedDeveloper
          ? { claimedDeveloper: report.entity.claimedDeveloper }
          : {}),
        ...(report.brand?.id ? { brandId: report.brand.id } : {}),
      });
      navigate(`/scans/${created.id}`);
    } catch (err) {
      setActionError(errorMessage(err));
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!scanId) return;
    setBusy("delete");
    setActionError(null);
    try {
      await m1.deleteScan(scanId);
      navigate("/scans");
    } catch (err) {
      setActionError(errorMessage(err));
      setBusy(null);
    }
  };

  const exportJson = () => {
    if (!scan.data) return;
    const blob = new Blob([JSON.stringify(scan.data.report, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `trustgraph-scan-${scanId}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (!scanId) return null;

  return (
    <>
      {scan.loading ? (
        <div className="space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : scan.error ? (
        <Card>
          <ErrorState error={scan.error} onRetry={scan.reload} context={`scan ${scanId}`} />
        </Card>
      ) : !scan.data ? (
        <Card>
          <EmptyState title="Scan not found" description="The scan may have been deleted." />
        </Card>
      ) : (
        <ScanReportView
          scanId={scanId}
          detail={scan.data}
          busy={busy}
          actionError={actionError}
          confirmDelete={confirmDelete}
          setConfirmDelete={setConfirmDelete}
          rescan={rescan}
          remove={remove}
          exportJson={exportJson}
        />
      )}
    </>
  );
}

function ScanReportView({
  scanId,
  detail,
  busy,
  actionError,
  confirmDelete,
  setConfirmDelete,
  rescan,
  remove,
  exportJson,
}: {
  scanId: string;
  detail: M1ScanDetail;
  busy: "rescan" | "delete" | null;
  actionError: string | null;
  confirmDelete: boolean;
  setConfirmDelete: (open: boolean) => void;
  rescan: () => void;
  remove: () => void;
  exportJson: () => void;
}) {
  const { report, history } = detail;

  return (
    <>
      <PageHeader
        title={report.entity.displayName || report.entity.target}
        description={`${M1_ENTITY_TYPE_LABEL[report.entity.type] ?? report.entity.type} · scanned ${formatDateTime(report.timestamp)}${report.brand ? ` against brand ${report.brand.name}` : " with no brand context"}`}
        actions={
          <>
            <Button onClick={rescan} disabled={busy !== null}>
              {busy === "rescan" ? "Scanning…" : "Re-scan"}
            </Button>
            <Button onClick={exportJson}>Export JSON</Button>
            {confirmDelete ? (
              <Button variant="danger" onClick={remove} disabled={busy !== null}>
                {busy === "delete" ? "Deleting…" : "Confirm delete"}
              </Button>
            ) : (
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            )}
          </>
        }
      />

      {actionError ? (
        <p role="alert" className="mb-4 rounded border border-risk-critical/40 bg-risk-critical/10 px-3 py-2 text-xs text-risk-critical">
          {actionError}
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="flex flex-col items-center justify-center gap-2 px-4 py-6">
          <M1RiskScore score={report.riskScore} level={report.riskLevel} size="lg" />
          <p className="text-[11px] text-faint">
            base {report.baseScore}
            {report.scoreAdjustments.length > 0
              ? ` · ${report.scoreAdjustments
                  .map((adj) => `${adj.kind === "FLOOR" ? "min" : "max"} ${adj.value}`)
                  .join(", ")}`
              : ""}
          </p>
        </Card>

        <Card className="px-4 py-4 md:col-span-2">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <KeyValue label="Confidence" mono>
              {report.confidenceScore}
            </KeyValue>
            <KeyValue label="Target" mono>
              {report.entity.target}
            </KeyValue>
            <KeyValue label="Intel mode">
              {report.intelMode === "live" ? (
                <Badge tone="action">Live</Badge>
              ) : (
                <Badge tone="evidence">Demo dataset</Badge>
              )}
            </KeyValue>
            <KeyValue label="Signals">
              {report.signals.length}
            </KeyValue>
            <KeyValue label="AI assessment" mono>
              {report.aiAssessment.source === "GROQ" ? (
                <Badge tone="ai">Groq</Badge>
              ) : (
                <Badge>Fallback</Badge>
              )}
            </KeyValue>
            <KeyValue label="Duration" mono>
              {(report.durationMs / 1000).toFixed(1)}s
            </KeyValue>
          </dl>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Category breakdown"
            description="Capped factor families — each contributes points toward the final score."
          />
          {report.categories.length === 0 ? (
            <EmptyState title="No category scores" description="This scan produced no category signals." />
          ) : (
            <ul className="divide-y divide-line-soft">
              {report.categories.map((category) => (
                <li key={category.category} className="px-4 py-3 sm:px-5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="font-medium text-fg">
                      {M1_CATEGORY_LABEL[category.category] ?? category.label}
                      {category.capped ? (
                        <span className="ml-2 text-faint">(capped at {category.cap})</span>
                      ) : null}
                    </span>
                    <span className="font-mono text-muted">
                      {category.points} pts · {category.signalCount} signal
                      {category.signalCount === 1 ? "" : "s"}
                      {category.mitigationPoints > 0
                        ? ` · −${category.mitigationPoints} mitigation`
                        : ""}
                    </span>
                  </div>
                  <M1ScoreBar value={category.percent} level={levelFromPercent(category.percent)} className="mt-2" />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Risk over time"
            description={
              history.length > 0
                ? `${history.length} scan${history.length === 1 ? "" : "s"} of this target — oldest to newest`
                : undefined
            }
          />
          {history.length === 0 ? (
            <EmptyState title="First scan" description="Re-scan the target to start a trend line." />
          ) : (
            <ol className="divide-y divide-line-soft">
              {history.map((point) => (
                <li
                  key={point.id}
                  className={`flex items-center justify-between gap-2 px-4 py-2 text-xs sm:px-5 ${point.id === scanId ? "bg-raised/50" : ""}`}
                >
                  <span className="font-mono text-fg">{point.riskScore}</span>
                  <M1RiskLevelBadge level={point.riskLevel} />
                  <span className="font-mono text-faint">{point.confidenceScore}</span>
                  <span className="text-faint">{formatDateTime(point.createdAt)}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader
          title={`Signals (${report.signals.length})`}
          description="Detected risk indicators with evidence, impact, provider, and data origin."
        />
        {report.signals.length === 0 ? (
          <EmptyState title="No signals detected" description="The engine found no risk indicators on this target." />
        ) : (
          <ul className="divide-y divide-line-soft">
            {report.signals.map((signal) => (
              <li key={signal.id} className="px-4 py-3 sm:px-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={SEVERITY_TONE[signal.severity]}>
                    {M1_SEVERITY_LABEL[signal.severity] ?? signal.severity}
                  </Badge>
                  <span className="text-[11px] uppercase tracking-widest text-faint">
                    {M1_CATEGORY_LABEL[signal.category] ?? signal.category}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
                    {signal.title}
                  </span>
                  <span className="font-mono text-[11px] text-muted">+{signal.impact}</span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted">{signal.description}</p>
                {signal.evidence ? (
                  <p className="mt-1 break-words font-mono text-[11px] leading-relaxed text-evidence">
                    {signal.evidence}
                  </p>
                ) : null}
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <Chip>{signal.provider}</Chip>
                  <Badge tone={signal.origin === "LIVE" ? "action" : "neutral"}>
                    {M1_ORIGIN_LABEL[signal.origin] ?? signal.origin}
                  </Badge>
                  {signal.reliability < 1 ? (
                    <span className="text-[11px] text-faint">
                      reliability {Math.round(signal.reliability * 100)}%
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Recommended actions"
            description="Prioritized response steps derived from the signals and AI assessment."
          />
          {report.recommendedActions.length === 0 ? (
            <EmptyState title="No actions recommended" description="Nothing actionable on this scan." />
          ) : (
            <ol className="divide-y divide-line-soft">
              {report.recommendedActions.map((action) => (
                <li key={action.id} className="px-4 py-3 sm:px-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={PRIORITY_TONE[action.priority] ?? "neutral"}>
                      {M1_PRIORITY_LABEL[action.priority] ?? action.priority}
                    </Badge>
                    <span className="text-sm font-medium text-fg">{action.action}</span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted">{action.rationale}</p>
                  {action.basedOn.length > 0 ? (
                    <p className="mt-1 text-[11px] text-faint">
                      Based on: {action.basedOn.join(", ")}
                    </p>
                  ) : null}
                  {(() => {
                    const note = report.aiAssessment.actionNotes.find(
                      (candidate) => candidate.actionId === action.id,
                    );
                    return note ? (
                      <p className="mt-1.5 rounded border border-ai/30 bg-ai/5 px-2 py-1 text-[11px] leading-relaxed text-ai">
                        {note.note}
                      </p>
                    ) : null;
                  })()}
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card>
          <CardHeader
            title="AI assessment"
            description={
              report.aiAssessment.source === "GROQ"
                ? `Groq LLM (${report.aiAssessment.model ?? "unknown model"}) — narrative layered on the deterministic score`
                : "Heuristic fallback — the LLM was unavailable, this text is rule-generated"
            }
          />
          <div className="space-y-3 px-4 py-4 sm:px-5">
            <p className="text-xs leading-relaxed text-fg">{report.aiAssessment.summary}</p>
            {report.aiAssessment.keyFindings.length > 0 ? (
              <div>
                <p className="text-[11px] font-medium uppercase tracking-widest text-faint">Key findings</p>
                <ul className="mt-1 space-y-1">
                  {report.aiAssessment.keyFindings.map((finding, index) => (
                    <li key={index} className="text-xs leading-relaxed text-muted">
                      — {finding.text}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {report.aiAssessment.caveats.length > 0 ? (
              <div>
                <p className="text-[11px] font-medium uppercase tracking-widest text-faint">Caveats</p>
                <ul className="mt-1 space-y-1">
                  {report.aiAssessment.caveats.map((caveat, index) => (
                    <li key={index} className="text-xs leading-relaxed text-muted">
                      — {caveat}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader
          title="Provider runs"
          description="Intelligence providers consulted during this scan, with latency and data origin."
        />
        <ul className="divide-y divide-line-soft">
          {report.providerRuns.map((run) => (
            <li key={run.providerId} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-xs sm:px-5">
              <Chip>{run.providerId}</Chip>
              <span className="text-fg">{run.providerName}</span>
              <Badge tone={run.origin === "LIVE" ? "action" : "neutral"}>
                {M1_ORIGIN_LABEL[run.origin] ?? run.origin}
              </Badge>
              <span className="font-mono text-muted">{run.status}</span>
              <span className="ml-auto font-mono text-faint">{run.latencyMs}ms</span>
              {run.message ? (
                <span className="w-full text-[11px] text-faint">{run.message}</span>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

function levelFromPercent(percent: number): M1RiskLevel {
  if (percent >= 80) return "CRITICAL";
  if (percent >= 60) return "HIGH";
  if (percent >= 40) return "MEDIUM";
  if (percent >= 20) return "LOW";
  return "VERY_LOW";
}
