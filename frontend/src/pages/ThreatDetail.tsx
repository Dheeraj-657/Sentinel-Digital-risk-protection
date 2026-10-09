import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useApi, useEnrichment, errorMessage } from "../lib/hooks";
import { m2, m3 } from "../lib/api";
import { useTenant } from "../lib/tenant";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Chip,
  EmptyState,
  ErrorState,
  KeyValue,
  PageHeader,
  RiskLevelBadge,
  RiskScore,
  ScoreBar,
} from "../components/ui";
import {
  CLASSIFICATION_LABEL,
  EVIDENCE_TYPE_LABEL,
  FACTOR_LABEL,
  FACTOR_LABEL_LOWER,
  cx,
  formatDateTime,
  pct,
} from "../lib/format";
import type { EvidenceReference, RiskFactor, ThreatDetail as ThreatDetailType } from "../lib/types";

const STATUS_ACTION_TONE: Record<string, "low" | "medium" | "neutral"> = {
  CONFIRMED: "low",
  OPEN: "medium",
  DISMISSED: "neutral",
};

export function ThreatDetail() {
  const { threatId = "" } = useParams();
  const { tenant } = useTenant();
  const threat = useApi(() => m2.getThreat(threatId, tenant), [tenant, threatId]);
  const [patching, setPatching] = useState(false);
  const [patchError, setPatchError] = useState<string | null>(null);

  if (threat.loading) {
    return (
      <>
        <PageHeader title="Threat" />
        <Card className="px-4 py-3.5">
          <div className="animate-pulse space-y-3">
            <div className="h-6 w-56 rounded bg-raised" />
            <div className="h-4 w-80 rounded bg-raised" />
          </div>
        </Card>
      </>
    );
  }

  if (threat.error) {
    return (
      <Card>
        <ErrorState
          error={threat.error}
          onRetry={threat.reload}
          context="threat"
        />
      </Card>
    );
  }

  const data = threat.data!;

  const patchStatus = async (status: "CONFIRMED" | "DISMISSED" | "OPEN") => {
    setPatching(true);
    setPatchError(null);
    try {
      await m2.updateThreatStatus(threatId, status, tenant);
      threat.reload();
    } catch (err) {
      setPatchError(errorMessage(err));
    } finally {
      setPatching(false);
    }
  };

  return (
    <>
      <PageHeader
        title={CLASSIFICATION_LABEL[data.classification]}
        description="Risk-engine verdict for one discovered entity, with the scoring breakdown and the evidence it rests on."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={`/entities/${data.entity_id}`}
              className="rounded border border-line bg-raised px-3 py-1.5 text-xs font-medium text-fg transition hover:border-action/60"
            >
              Investigate entity
            </Link>
            <Link to={`/analysis/new?brand=${encodeURIComponent(data.brand_id)}&entity=${encodeURIComponent(data.entity_id)}`}>
              <Button variant="primary">Re-run analysis</Button>
            </Link>
          </div>
        }
      />

      <Card className="px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold tracking-tight text-fg">
                {CLASSIFICATION_LABEL[data.classification]}
              </h2>
              <RiskLevelBadge level={data.risk_level} />
              <Badge tone={STATUS_ACTION_TONE[data.status] ?? "neutral"}>{data.status}</Badge>
            </div>
            <p className="text-xs text-muted">
              Entity{" "}
              <Link to={`/entities/${data.entity_id}`} className="font-mono text-action hover:underline">
                {data.entity_id}
              </Link>{" "}
              scored against brand{" "}
              <span className="font-mono">{data.brand_id}</span>
            </p>
          </div>
          <RiskScore score={data.risk_score} level={data.risk_level} size="lg" />
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-line-soft pt-4 sm:grid-cols-4">
          <KeyValue label="Confidence" mono>
            {pct(data.confidence)}
          </KeyValue>
          <KeyValue label="Engine version" mono>
            {data.risk_engine_version}
          </KeyValue>
          <KeyValue label="Analyzed" mono>
            {formatDateTime(data.analysis_timestamp)}
          </KeyValue>
          <KeyValue label="Updated" mono>
            {formatDateTime(data.updated_at)}
          </KeyValue>
        </dl>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line-soft pt-4">
          <span className="text-[11px] font-medium uppercase tracking-widest text-faint">
            Response
          </span>
          {data.status === "OPEN" ? (
            <>
              <Button variant="primary" disabled={patching} onClick={() => patchStatus("CONFIRMED")}>
                {patching ? "Confirming…" : "Confirm threat"}
              </Button>
              <Button variant="danger" disabled={patching} onClick={() => patchStatus("DISMISSED")}>
                Dismiss
              </Button>
            </>
          ) : (
            <Button disabled={patching} onClick={() => patchStatus("OPEN")}>
              {patching ? "Reopening…" : "Reopen"}
            </Button>
          )}
          {patchError ? (
            <p role="alert" className="text-xs text-risk-medium">
              {patchError}
            </p>
          ) : null}
        </div>
      </Card>

      <ScoreExplanation threat={data} />
      <FactorBreakdown factors={data.risk_factors} />
      <EvidencePanel threat={data} />
      <NextSteps threat={data} />
    </>
  );
}

/** Plain-language account of how the score was assembled — derived from the
 * actual factor contributions, not hardcoded copy. */
function ScoreExplanation({ threat }: { threat: ThreatDetailType }) {
  const ordered = [...threat.risk_factors].sort((a, b) => b.contribution - a.contribution);
  const drivers = ordered.slice(0, 3).filter((factor) => factor.contribution > 0);
  const top = drivers[0];

  const sentence = top
    ? `The score of ${Math.round(threat.risk_score)} is driven primarily by ${FACTOR_LABEL_LOWER[top.factor_type]} (${top.contribution.toFixed(1)} of the total points)${
        drivers.length > 1
          ? `, followed by ${drivers.slice(1).map((factor) => FACTOR_LABEL_LOWER[factor.factor_type]).join(" and ")}`
          : ""
      }.`
    : `The score of ${Math.round(threat.risk_score)} has no single dominant factor.`;

  return (
    <Card className="mt-4">
      <CardHeader
        title="Why this score"
        description="Generated from the engine's factor weights and the observed evidence — every claim below traces to a factor row."
      />
      <div className="space-y-3 px-4 py-4 sm:px-5">
        <p className="text-sm leading-relaxed text-fg">{sentence}</p>
        <p className="text-xs leading-relaxed text-muted">
          The engine weights each factor family (identity {pct(0.2)}, visual {pct(0.2)}, text{" "}
          {pct(0.15)}, domain {pct(0.15)}, behavioral {pct(0.1)}, reputation {pct(0.1)},
          relationship {pct(0.1)}) and scales by evidence confidence. Factor-level confidence
          reflects evidence quality; basis marks whether a factor is OBSERVED (measured from
          evidence) or INFERRED (model-derived).
        </p>
        <p className="text-xs leading-relaxed text-muted">
          Confidence in the verdict: {pct(threat.confidence)} — engine v{threat.risk_engine_version}.
        </p>
      </div>
    </Card>
  );
}

function FactorBreakdown({ factors }: { factors: RiskFactor[] }) {
  const ordered = [...factors].sort((a, b) => b.contribution - a.contribution);
  return (
    <Card className="mt-4">
      <CardHeader
        title="Risk factors"
        description="Each family's 0–100 score, its engine weight, and the points it contributed."
      />
      {ordered.length === 0 ? (
        <EmptyState title="No factor detail" description="This threat record has no factor rows." />
      ) : (
        <ul className="divide-y divide-line-soft">
          {ordered.map((factor) => (
            <li key={factor.factor_id} className="px-4 py-3.5 sm:px-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium text-fg">{FACTOR_LABEL[factor.factor_type]}</p>
                <p className="font-mono text-xs text-muted">
                  {factor.contribution.toFixed(1)} pts
                </p>
              </div>
              <div className="mt-2">
                <ScoreBar value={factor.score} level={scoreLevel(factor.score)} />
              </div>
              <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-muted">
                <div className="flex gap-1.5">
                  <dt className="text-faint">score</dt>
                  <dd className="font-mono">{Math.round(factor.score)}/100</dd>
                </div>
                <div className="flex gap-1.5">
                  <dt className="text-faint">weight</dt>
                  <dd className="font-mono">{pct(factor.weight)}</dd>
                </div>
                <div className="flex gap-1.5">
                  <dt className="text-faint">confidence</dt>
                  <dd className="font-mono">{pct(factor.confidence)}</dd>
                </div>
                <div className="flex gap-1.5">
                  <dt className="text-faint">basis</dt>
                  <dd>
                    <Badge tone={factor.basis === "OBSERVED" ? "evidence" : "ai"}>
                      {factor.basis}
                    </Badge>
                  </dd>
                </div>
                <div className="flex gap-1.5">
                  <dt className="text-faint">evidence</dt>
                  <dd className="font-mono">{factor.evidence_ids.length} item{factor.evidence_ids.length === 1 ? "" : "s"}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function scoreLevel(score: number): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" {
  if (score > 75) return "CRITICAL";
  if (score > 50) return "HIGH";
  if (score > 25) return "MEDIUM";
  return "LOW";
}

/** Joins the threat's evidence references to Module 3's evidence records and
 * source registry so every claim shows its provenance. */
function EvidencePanel({ threat }: { threat: ThreatDetailType }) {
  const { tenant } = useTenant();
  const evidence = useApi(
    () => m3.listEvidence(threat.entity_id, tenant),
    [tenant, threat.entity_id],
  );
  const sources = useApi(() => m3.listSources({ limit: 200 }, tenant), [tenant]);
  const { entityName, brandName } = useEnrichment();

  const byId = new Map((evidence.data ?? []).map((item) => [item.evidence_id, item]));
  const sourceNames = new Map((sources.data?.items ?? []).map((source) => [source.source_id, source.name]));

  return (
    <Card className="mt-4">
      <CardHeader
        title="Evidence & provenance"
        description={`${threat.evidence_references.length} evidence item${threat.evidence_references.length === 1 ? "" : "s"} considered — retrieved live from the evidence store.`}
        actions={
          <Link
            to={`/entities/${threat.entity_id}`}
            className="rounded border border-line bg-raised px-3 py-1.5 text-xs font-medium text-fg transition hover:border-action/60"
          >
            View entity evidence
          </Link>
        }
      />
      {threat.evidence_references.length === 0 ? (
        <EmptyState
          title="No evidence referenced"
          description="The engine did not cite specific evidence items for this threat."
        />
      ) : (
        <ul className="divide-y divide-line-soft">
          {threat.evidence_references.map((reference) => (
            <li key={reference.evidence_id} className="px-4 py-3.5 sm:px-5">
              <EvidenceRow
                reference={reference}
                detail={byId.get(reference.evidence_id)}
                sourceName={sourceNames.get(reference.source_id)}
              />
            </li>
          ))}
        </ul>
      )}
      {evidence.error ? (
        <p className="border-t border-line-soft px-4 py-2.5 text-xs text-risk-medium sm:px-5" role="alert">
          Evidence store unreachable ({errorMessage(evidence.error)}) — provenance names may be incomplete.
        </p>
      ) : null}
      <p className="border-t border-line-soft px-4 py-2.5 text-[11px] leading-relaxed text-faint sm:px-5">
        Scored for <span className="text-muted">{entityName(threat.entity_id)}</span> against brand{" "}
        <span className="text-muted">{brandName(threat.brand_id)}</span>. Evidence marked SYNTHETIC
        TEST_ONLY in its source name is fixture data, not live discovery.
      </p>
    </Card>
  );
}

function EvidenceRow({
  reference,
  detail,
  sourceName,
}: {
  reference: EvidenceReference;
  detail?: { evidence_type: string; text: string | null; url: string | null; image_hash: string | null; collected_at: string };
  sourceName?: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="evidence">
          {EVIDENCE_TYPE_LABEL[detail?.evidence_type ?? ""] ?? "Evidence"}
        </Badge>
        <span className="font-mono text-xs text-muted">{reference.evidence_id}</span>
        {sourceName ? (
          <span className="text-xs text-faint">
            via <span className="text-muted">{sourceName}</span>
          </span>
        ) : (
          <span className="text-xs text-faint">via source {reference.source_id}</span>
        )}
      </div>
      {detail ? (
        <dl className="space-y-1 text-xs">
          {detail.text ? (
            <div>
              <dt className="sr-only">Text</dt>
              <dd className="text-muted">&ldquo;{detail.text}&rdquo;</dd>
            </div>
          ) : null}
          {detail.url ? (
            <div className="flex gap-2">
              <dt className="text-faint">URL</dt>
              <dd className="min-w-0 break-all font-mono text-[11px] text-action">{detail.url}</dd>
            </div>
          ) : null}
          {detail.image_hash ? (
            <div className="flex gap-2">
              <dt className="text-faint">Image hash</dt>
              <dd className="font-mono text-[11px] text-muted">{detail.image_hash}</dd>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <div className="flex gap-2">
              <dt className="text-faint">Collected</dt>
              <dd className="text-muted">{formatDateTime(detail.collected_at)}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-faint">Used in</dt>
              <dd className="flex flex-wrap gap-1">
                {reference.factor_types.length === 0 ? (
                  <span className="text-muted">no factor</span>
                ) : (
                  reference.factor_types.map((type) => <Chip key={type}>{FACTOR_LABEL[type]}</Chip>)
                )}
              </dd>
            </div>
          </div>
        </dl>
      ) : (
        <p className="text-xs text-faint">
          Detail not available from the evidence store (item may have been deleted or belongs to
          another tenant). Cited by factors: {reference.factor_types.length}.
        </p>
      )}
    </div>
  );
}

/** Suggested next steps derived from the verdict — a generic analyst
 * playbook, not an automated action. */
function NextSteps({ threat }: { threat: ThreatDetailType }) {
  const steps = recommendedSteps(threat);
  return (
    <Card className="mt-4">
      <CardHeader
        title="Suggested next steps"
        description="Analyst playbook derived from this verdict — manual actions, not automation."
      />
      <ol className="space-y-2.5 px-4 py-4 sm:px-5">
        {steps.map((step, index) => (
          <li key={step} className="flex gap-3 text-sm leading-relaxed">
            <span className={cx("font-mono text-xs text-faint", "shrink-0 pt-0.5")}>
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="text-fg">{step}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function recommendedSteps(threat: ThreatDetailType): string[] {
  const steps: string[] = [];
  if (threat.status === "DISMISSED") {
    steps.push("Threat is dismissed — no action required. Reopen if new evidence emerges.");
    return steps;
  }
  if (threat.risk_level === "CRITICAL" || threat.risk_level === "HIGH") {
    steps.push(
      "Escalate to the brand's security response owner with this evidence trail attached.",
    );
  }
  if (threat.status === "OPEN") {
    steps.push(
      "Review the evidence provenance below and confirm or dismiss the threat so the register reflects the decision.",
    );
  } else {
    steps.push("Threat is confirmed — proceed with the response plan for its entity type.");
  }
  const domainEvidence = threat.evidence_references.some(
    (reference) => reference.factor_types.includes("DOMAIN_SIGNALS"),
  );
  if (domainEvidence) {
    steps.push(
      "Domain evidence is present — validate registration age and registrar via WHOIS before any takedown request.",
    );
  }
  steps.push("Collect fresh evidence through Sentinel DRP and re-run the analysis to track drift.");
  return steps;
}
