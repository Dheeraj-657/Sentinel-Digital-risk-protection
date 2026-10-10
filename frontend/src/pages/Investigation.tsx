import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ApiError, m1, m2, m3 } from "../lib/api";
import { errorMessage, useApi } from "../lib/hooks";
import { useTenant } from "../lib/tenant";
import { findBrandForUuid } from "../lib/brand-bridge";
import {
  CLASSIFICATION_LABEL,
  cx,
  ENTITY_TYPE_LABEL,
  EVIDENCE_TYPE_LABEL,
  FACTOR_LABEL,
  formatDateTime,
  JOB_STATUS_LABEL,
  M1_RISK_LEVEL_LABEL,
  pct,
  RISK_LEVEL_BAR,
  RISK_LEVEL_CLASS,
  RISK_LEVEL_LABEL,
  shortId,
} from "../lib/format";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  RiskLevelBadge,
  ScoreBar,
  Skeleton,
  TableSkeleton,
} from "../components/ui";
import { CopyButton } from "../components/copy-button";
import { AnalystPanel, type CompareOption } from "../components/analyst-panel";
import { recommendedSteps, scoreLevel } from "./ThreatDetail";
import type {
  FactorType,
  M1Brand,
  M3Entity,
  M3Evidence,
  RelatedThreatItem,
  ThreatDetail,
  ThreatSummary,
} from "../lib/types";

type Tab = "overview" | "evidence" | "risk" | "connections" | "history";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "evidence", label: "Evidence" },
  { id: "risk", label: "Risk breakdown" },
  { id: "connections", label: "Connections" },
  { id: "history", label: "History" },
];

const ALL_FACTORS: FactorType[] = [
  "IDENTITY_SIMILARITY",
  "VISUAL_SIMILARITY",
  "TEXT_SIMILARITY",
  "DOMAIN_SIGNALS",
  "BEHAVIORAL_SIGNALS",
  "REPUTATION_SIGNALS",
  "RELATIONSHIP_SIGNALS",
];

/** The four report concepts, kept visually distinct throughout the workspace. */
function ConceptTag({ kind }: { kind: "evidence" | "risk" | "ai" | "rec" }) {
  const map = {
    evidence: { label: "Collected evidence", cls: "border-evidence/40 text-evidence" },
    risk: { label: "Calculated risk", cls: "border-action/40 text-action" },
    ai: { label: "AI assessment", cls: "border-ai/40 text-ai" },
    rec: { label: "Recommended actions", cls: "border-rec/40 text-rec" },
  }[kind];
  return <span className={cx("rounded border px-1.5 py-px text-[11px] font-medium", map.cls)}>{map.label}</span>;
}

export function Investigation() {
  const { entityId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { tenant } = useTenant();

  const tab = (TABS.find((t) => t.id === searchParams.get("tab"))?.id ?? "overview") as Tab;
  const setTab = (next: Tab) => {
    const params = new URLSearchParams(searchParams);
    if (next === "overview") params.delete("tab");
    else params.set("tab", next);
    setSearchParams(params, { replace: true });
  };

  const entity = useApi(() => m3.getEntity(entityId, tenant), [tenant, entityId]);
  const evidence = useApi(() => m3.listEvidence(entityId, tenant), [tenant, entityId]);
  const sources = useApi(() => m3.listSources({ limit: 200 }, tenant), [tenant]);
  const threatList = useApi(() => m2.listThreats({ limit: 200 }, tenant), [tenant]);
  const brands = useApi(() => m1.listBrands(), []);

  const verdicts = useMemo(
    () => (threatList.data?.items ?? []).filter((t) => t.entity_id === entityId),
    [threatList.data, entityId],
  );
  const selectedId = searchParams.get("threat") && verdicts.some((v) => v.threat_id === searchParams.get("threat"))
    ? searchParams.get("threat")
    : verdicts[0]?.threat_id ?? null;

  const threat = useApi<ThreatDetail | null>(
    () => (selectedId ? m2.getThreat(selectedId, tenant) : Promise.resolve(null)),
    [tenant, selectedId],
  );
  const related = useApi(
    () => (selectedId ? m2.getRelated(selectedId, tenant) : Promise.resolve(null)),
    [tenant, selectedId],
  );

  const brandFor = useCallback(
    (brandUuid: string): M1Brand | undefined => findBrandForUuid(brands.data?.items ?? [], brandUuid),
    [brands.data],
  );
  // "Unregistered" only when the registry answered; an unreachable registry is unknown.
  const brandLabel = (uuid: string): string =>
    brandFor(uuid)?.name ??
    (brands.error ? `brand ${shortId(uuid)} (registry unavailable)` : brands.loading ? `brand ${shortId(uuid)}` : `unregistered brand ${shortId(uuid)}`);

  // Evidence focus from analyst citations / factor chips.
  const [focusEvidence, setFocusEvidence] = useState<string | null>(searchParams.get("ev"));
  const citeEvidence = useCallback(
    (id: string) => {
      setFocusEvidence(id);
      const params = new URLSearchParams(searchParams);
      params.set("tab", "evidence");
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );
  useEffect(() => {
    if (tab !== "evidence" || !focusEvidence) return;
    const el = document.getElementById(`ev-${focusEvidence}`);
    el?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    el?.focus({ preventScroll: true });
  }, [tab, focusEvidence, evidence.data]);

  const selectVerdict = (threatId: string) => {
    const params = new URLSearchParams(searchParams);
    params.set("threat", threatId);
    setSearchParams(params, { replace: true });
  };

  if (entity.loading) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading investigation">
        <Skeleton className="h-16 w-2/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  // Evidence store unreachable (5xx/network) but the risk engine still has verdicts:
  // keep the workspace usable and say exactly what is missing.
  const storeDown = !!entity.error && !(entity.error instanceof ApiError && entity.error.status < 500);
  if (storeDown && threatList.loading) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading investigation">
        <Skeleton className="h-16 w-2/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  const degraded = storeDown && verdicts.length > 0;
  if (!degraded && (entity.error || !entity.data)) {
    return (
      <Card>
        <ErrorState error={entity.error ?? new Error("Entity not found.")} onRetry={entity.reload} context="this entity" />
        <p className="pb-6 text-center text-xs">
          <Link to="/investigate" className="text-action hover:text-fg">
            Back to investigations
          </Link>
        </p>
      </Card>
    );
  }

  const e: M3Entity = entity.data ?? {
    entity_id: entityId,
    tenant_id: tenant,
    entity_type: "OTHER",
    display_name: `Entity ${shortId(entityId)} (details unavailable)`,
    identifiers: {},
    attributes: {},
  };
  const t = threat.data;
  const brand = t ? brandFor(t.brand_id) : undefined;
  const relatedItems = related.data?.items ?? [];
  // Relations that failed or came back with engine warnings are unknown, not "none".
  const relationsIncomplete = !!related.error || (related.data?.warnings?.length ?? 0) > 0;
  const usage = new Map<string, FactorType[]>();
  for (const ref of t?.evidence_references ?? []) usage.set(ref.evidence_id, ref.factor_types);
  const sourceName = new Map((sources.data?.items ?? []).map((s) => [s.source_id, s.name]));

  const compareOptions: CompareOption[] = [
    ...verdicts
      .filter((v) => v.threat_id !== selectedId)
      .map((v) => ({
        threatId: v.threat_id,
        label: `Same entity vs ${brandLabel(v.brand_id)} (${v.risk_score} ${RISK_LEVEL_LABEL[v.risk_level]})`,
      })),
    ...uniqueBy(
      relatedItems.filter((r) => r.entity_id !== entityId),
      (r) => r.threat_id,
    ).map((r) => ({ threatId: r.threat_id, label: `${r.entity_display_name ?? shortId(r.entity_id)} (shares ${r.shared_attribute.key})` })),
  ];

  // Potential-campaign members: this verdict plus verdicts on OTHER entities the
  // risk engine linked by an exact shared identifier. Nothing else is grouped.
  const campaignThreatIds = selectedId
    ? [selectedId, ...uniqueBy(relatedItems.filter((r) => r.entity_id !== entityId), (r) => r.threat_id).map((r) => r.threat_id)].slice(0, 12)
    : [];

  return (
    <div>
      {degraded ? (
        <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-risk-medium/40 bg-risk-medium/5 px-4 py-3 text-[13px]">
          <p className="min-w-0 text-fg">
            <span className="font-semibold">Evidence store unavailable.</span>{" "}
            <span className="text-muted">
              Entity details, identifiers and evidence can't be loaded ({errorMessage(entity.error)}). Verdicts below come from the
              risk engine; nothing here is inferred from the missing data.
            </span>
          </p>
          <button type="button" onClick={() => { entity.reload(); evidence.reload(); }} className="rounded-md border border-line px-2.5 py-1 text-xs text-fg hover:border-action/60">
            Retry
          </button>
        </div>
      ) : null}
      <EntityHeader
        entity={e}
        verdicts={verdicts}
        selectedId={selectedId}
        onSelect={selectVerdict}
        brandName={brandLabel}
        threat={t}
        verdictsLoading={threatList.loading}
      />

      <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0">
          <div role="tablist" aria-label="Investigation sections" className="mb-4 flex gap-1 overflow-x-auto border-b border-line-soft">
            {TABS.map((item) => {
              const count =
                item.id === "evidence"
                  ? evidence.data?.length
                  : item.id === "connections"
                    ? relationsIncomplete && relatedItems.length === 0
                      ? "?"
                      : relatedItems.length
                    : undefined;
              return (
                <button
                  key={item.id}
                  role="tab"
                  type="button"
                  id={`tab-${item.id}`}
                  aria-selected={tab === item.id}
                  aria-controls={`panel-${item.id}`}
                  onClick={() => setTab(item.id)}
                  className={cx(
                    "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-medium transition",
                    tab === item.id ? "border-action text-fg" : "border-transparent text-muted hover:text-fg",
                  )}
                >
                  {item.label}
                  {count !== undefined ? <span className="ml-1.5 text-xs text-faint">{count}</span> : null}
                </button>
              );
            })}
          </div>

          <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
            {tab === "overview" ? (
              <OverviewTab
                entity={e}
                threat={t}
                threatLoading={threat.loading || threatList.loading}
                threatError={threat.error ?? threatList.error}
                brand={brand}
                brandsError={brands.error}
                evidence={evidence.data ?? []}
                evidenceLoading={evidence.loading}
                evidenceError={evidence.error}
                relatedCount={relatedItems.filter((r) => r.entity_id !== entityId).length}
                relationsIncomplete={relationsIncomplete}
                onTab={setTab}
              />
            ) : tab === "evidence" ? (
              <EvidenceTab
                items={evidence.data}
                loading={evidence.loading}
                error={evidence.error}
                reload={evidence.reload}
                usage={usage}
                sourceName={sourceName}
                focused={focusEvidence}
              />
            ) : tab === "risk" ? (
              <RiskTab threat={t} loading={threat.loading || threatList.loading} error={threat.error} onCite={citeEvidence} entityId={entityId} />
            ) : tab === "connections" ? (
              <ConnectionsTab
                entityId={entityId}
                hasVerdict={!!selectedId}
                items={relatedItems}
                warnings={related.data?.warnings ?? []}
                loading={related.loading}
                error={related.error}
                reload={related.reload}
                onCite={citeEvidence}
              />
            ) : (
              <HistoryTab entity={e} verdicts={verdicts} brandName={brandLabel} />
            )}
          </div>
        </div>

        <div className="xl:sticky xl:top-[4.5rem] xl:h-[calc(100dvh-6rem)]">
          <AnalystPanel
            entityId={entityId}
            threatId={selectedId}
            riskLevel={t?.risk_level ?? null}
            hasRelations={relatedItems.some((r) => r.entity_id !== entityId)}
            compareOptions={compareOptions}
            campaignThreatIds={campaignThreatIds}
            onCiteEvidence={citeEvidence}
          />
        </div>
      </div>
    </div>
  );
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/* ------------------------------------------------------------------ header */

function EntityHeader({
  entity,
  verdicts,
  selectedId,
  onSelect,
  brandName,
  threat,
  verdictsLoading,
}: {
  entity: M3Entity;
  verdicts: ThreatSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  brandName: (uuid: string) => string;
  threat: ThreatDetail | null;
  verdictsLoading: boolean;
}) {
  const identifiers = Object.entries(entity.identifiers);
  return (
    <header className="rounded-lg border border-line-soft bg-panel px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <Link to="/investigate" className="hover:text-fg">
              Investigations
            </Link>
            <span aria-hidden>/</span>
            <span>{ENTITY_TYPE_LABEL[entity.entity_type] ?? entity.entity_type}</span>
          </p>
          <h1 className="font-display mt-1 break-words text-2xl font-semibold text-fg">
            {entity.display_name ?? shortId(entity.entity_id)}
          </h1>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5" aria-label="Identifiers">
            {identifiers.map(([key, value]) => (
              <li key={key} className="flex items-center gap-1.5 text-xs">
                <span className="text-faint">{key}</span>
                <span className="font-mono text-fg">{value}</span>
                <CopyButton value={value} label={`${key} ${value}`} />
              </li>
            ))}
            <li className="flex items-center gap-1.5 text-xs">
              <span className="text-faint">entity id</span>
              <span className="font-mono text-muted">{shortId(entity.entity_id)}</span>
              <CopyButton value={entity.entity_id} label="entity id" />
            </li>
          </ul>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={`/graph?focus=${entity.entity_id}`}
            className="rounded-md border border-line bg-raised/70 px-3 py-1.5 text-[13px] font-medium text-fg transition hover:border-action/60"
          >
            View in graph
          </Link>
          {threat ? (
            <Link
              to={`/threats/${threat.threat_id}`}
              className="rounded-md border border-line bg-raised/70 px-3 py-1.5 text-[13px] font-medium text-fg transition hover:border-action/60"
            >
              Triage verdict
            </Link>
          ) : null}
          <Link
            to={`/analysis/new?entity=${entity.entity_id}${threat ? `&brand=${threat.brand_id}` : ""}`}
            className="rounded-md bg-action px-3 py-1.5 text-[13px] font-semibold text-on-action transition hover:bg-action-strong"
          >
            {threat ? "Re-run analysis" : "Run analysis"}
          </Link>
        </div>
      </div>

      <div className="mt-4 border-t border-line-soft pt-3">
        <p className="mb-2 text-xs text-muted">
          Risk-engine verdicts for this entity{verdicts.length > 1 ? ". Select the brand to investigate against." : ""}
        </p>
        {verdictsLoading ? (
          <Skeleton className="h-9 w-72" />
        ) : verdicts.length === 0 ? (
          <p className="text-[13px] text-muted">
            No verdict yet. The risk engine has not analysed this entity, so there is no score to show.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Verdict">
            {verdicts.map((v) => (
              <button
                key={v.threat_id}
                type="button"
                role="radio"
                aria-checked={v.threat_id === selectedId}
                onClick={() => onSelect(v.threat_id)}
                className={cx(
                  "flex items-center gap-2 rounded-md border px-3 py-1.5 text-left text-[13px] transition",
                  v.threat_id === selectedId ? "border-action bg-action/10" : "border-line hover:border-faint",
                )}
              >
                <span className={cx("font-condensed font-mono text-lg font-bold leading-none", RISK_LEVEL_CLASS[v.risk_level])}>
                  {v.risk_score}
                </span>
                <span>
                  <span className="block text-fg">vs {brandName(v.brand_id)}</span>
                  <span className="block text-[11px] text-faint">
                    {RISK_LEVEL_LABEL[v.risk_level]}, {v.status.toLowerCase()}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </header>
  );
}

/* ---------------------------------------------------------------- overview */

function OverviewTab({
  entity,
  threat,
  threatLoading,
  threatError,
  brand,
  brandsError,
  evidence,
  evidenceLoading,
  evidenceError,
  relatedCount,
  relationsIncomplete,
  onTab,
}: {
  entity: M3Entity;
  threat: ThreatDetail | null;
  threatLoading: boolean;
  threatError: Error | null;
  brand: M1Brand | undefined;
  brandsError: Error | null;
  evidence: M3Evidence[];
  evidenceLoading: boolean;
  evidenceError: Error | null;
  relatedCount: number;
  relationsIncomplete: boolean;
  onTab: (tab: Tab) => void;
}) {
  const byType = new Map<string, number>();
  for (const item of evidence) byType.set(item.evidence_type, (byType.get(item.evidence_type) ?? 0) + 1);
  const attributes = Object.entries(entity.attributes ?? {});
  const discoveryJob = typeof entity.attributes?.discovery_job_id === "string" ? (entity.attributes.discovery_job_id as string) : null;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {/* Calculated risk */}
      <Card className="lg:col-span-2">
        <CardHeader title="Verdict" description="Output of the deterministic risk engine. Not recalculated in the console." actions={<ConceptTag kind="risk" />} />
        <div className="px-4 py-4 sm:px-5">
          {threatLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : threatError ? (
            <ErrorState error={threatError} context="the verdict" />
          ) : !threat ? (
            <EmptyState
              title="No verdict yet"
              description="Run an analysis to score this entity's stored evidence against a protected brand."
            />
          ) : (
            <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
              <div>
                <span className={cx("font-condensed font-mono text-6xl font-bold leading-none", RISK_LEVEL_CLASS[threat.risk_level])}>
                  {threat.risk_score}
                </span>
                <span className="ml-1 text-sm text-faint">/100</span>
              </div>
              <dl className="grid flex-1 grid-cols-2 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-3">
                <Fact label="Risk level"><RiskLevelBadge level={threat.risk_level} /></Fact>
                <Fact label="Classification">{CLASSIFICATION_LABEL[threat.classification]}</Fact>
                <Fact label="Confidence">{pct(threat.confidence)}</Fact>
                <Fact label="Analyst status">{threat.status.toLowerCase()}</Fact>
                <Fact label="Analyzed">{formatDateTime(threat.analysis_timestamp)}</Fact>
                <Fact label="Engine">v{threat.risk_engine_version}</Fact>
              </dl>
            </div>
          )}
        </div>
      </Card>

      {/* Brand reference */}
      <Card>
        <CardHeader title="Protected brand reference" description="Brand DNA from the brand registry, compared by exact value." />
        <div className="space-y-3 px-4 py-4 text-[13px] sm:px-5">
          {!threat ? (
            <p className="text-muted">A brand is attached once a verdict exists.</p>
          ) : !brand && brandsError ? (
            <p className="text-risk-medium">
              The brand registry (Module 1) could not be reached ({errorMessage(brandsError)}), so the brand reference for{" "}
              {shortId(threat.brand_id)} is unknown.
            </p>
          ) : !brand ? (
            <p className="text-muted">
              The verdict's brand ({shortId(threat.brand_id)}) is not in the brand registry. It may have been deleted.
            </p>
          ) : (
            <>
              <p>
                <Link to={`/brands/${brand.id}`} className="font-semibold text-fg hover:text-action">
                  {brand.name}
                </Link>
                {brand.isDemo ? <span className="ml-2 text-xs text-faint">demo brand</span> : null}
              </p>
              <BrandList label="Official domains" values={brand.officialDomains} />
              <BrandList label="Official handles" values={brand.officialHandles.map((h) => `@${h}`)} />
              <BrandList label="Official app developers" values={brand.appDevelopers} />
              <div className="border-t border-line-soft pt-3">
                <p className="mb-1.5 text-xs text-faint">This entity against the official assets</p>
                <ul className="space-y-1">
                  {Object.entries(entity.identifiers).map(([key, value]) => {
                    const official =
                      (key === "domain" && brand.officialDomains.includes(value.toLowerCase())) ||
                      (key === "handle" && brand.officialHandles.includes(value.toLowerCase().replace(/^@/, "")));
                    return (
                      <li key={key} className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate font-mono text-xs">{value}</span>
                        <Badge tone={official ? "low" : "neutral"}>{official ? "Official asset" : "Not an official asset"}</Badge>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </>
          )}
        </div>
      </Card>

      {/* Collected evidence summary + discovery metadata */}
      <Card>
        <CardHeader title="Evidence and discovery" description="What has been collected and where the entity came from." actions={<ConceptTag kind="evidence" />} />
        <div className="space-y-3 px-4 py-4 text-[13px] sm:px-5">
          {evidenceLoading ? (
            <Skeleton className="h-12 w-full" />
          ) : evidenceError ? (
            <p className="text-risk-medium">
              Evidence could not be loaded ({errorMessage(evidenceError)}). Whether evidence exists is unknown — this is not the
              same as having none.
            </p>
          ) : evidence.length === 0 ? (
            <p className="text-muted">No evidence is stored for this entity. Without evidence the engine cannot score it.</p>
          ) : (
            <>
              <p>
                <button type="button" onClick={() => onTab("evidence")} className="font-semibold text-fg hover:text-action">
                  {evidence.length} evidence item{evidence.length === 1 ? "" : "s"}
                </button>
                <span className="text-muted">
                  {" "}collected {formatDateTime(evidence[0].collected_at)}
                  {evidence.length > 1 ? ` to ${formatDateTime(evidence[evidence.length - 1].collected_at)}` : ""}.
                </span>
              </p>
              <div className="flex flex-wrap gap-1.5">
                {[...byType.entries()].map(([type, count]) => (
                  <Badge key={type} tone="evidence">
                    {EVIDENCE_TYPE_LABEL[type] ?? type}: {count}
                  </Badge>
                ))}
              </div>
            </>
          )}
          <div className="border-t border-line-soft pt-3">
            <p className="mb-1.5 text-xs text-faint">Discovery metadata</p>
            {discoveryJob ? (
              <p className="mb-1.5">
                Found by automatic discovery:{" "}
                <Link to={`/discovery/${discoveryJob}`} className="text-action hover:text-fg">
                  job {shortId(discoveryJob)}
                </Link>
              </p>
            ) : (
              <p className="mb-1.5 text-muted">Registered manually (no discovery job attached).</p>
            )}
            {attributes.filter(([k]) => k !== "discovery_job_id").length ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                {attributes
                  .filter(([k]) => k !== "discovery_job_id")
                  .slice(0, 8)
                  .map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-faint">{k}</dt>
                      <dd className="break-words text-fg">{typeof v === "string" ? v : JSON.stringify(v)}</dd>
                    </div>
                  ))}
              </dl>
            ) : null}
          </div>
          <p className="border-t border-line-soft pt-3">
            <button type="button" onClick={() => onTab("connections")} className="text-fg hover:text-action">
              {relationsIncomplete && relatedCount === 0
                ? "Relations could not be fully computed — see Connections"
                : `${relatedCount} other entit${relatedCount === 1 ? "y shares" : "ies share"} an exact identifier`}
            </button>
          </p>
        </div>
      </Card>

      {/* Recommended actions */}
      <Card className="lg:col-span-2">
        <CardHeader
          title="Recommended actions"
          description="Analyst playbook derived from the verdict. These are manual steps; TRUSTGRAPH does not execute them."
          actions={<ConceptTag kind="rec" />}
        />
        {threat ? (
          <ol className="space-y-2 px-4 py-4 sm:px-5">
            {recommendedSteps(threat).map((step, i) => (
              <li key={step} className="flex gap-3 text-[13px] leading-relaxed">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-rec/40 text-[11px] text-rec">
                  {i + 1}
                </span>
                <span className="text-fg">{step}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="px-4 py-4 text-[13px] text-muted sm:px-5">Run an analysis first; actions are derived from the verdict.</p>
        )}
      </Card>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-faint">{label}</dt>
      <dd className="mt-0.5 text-fg">{children}</dd>
    </div>
  );
}

function BrandList({ label, values }: { label: string; values: string[] }) {
  return (
    <div>
      <p className="text-xs text-faint">{label}</p>
      <p className="font-mono text-xs text-fg">{values.length ? values.join(", ") : "None on file"}</p>
    </div>
  );
}

/* ---------------------------------------------------------------- evidence */

function EvidenceTab({
  items,
  loading,
  error,
  reload,
  usage,
  sourceName,
  focused,
}: {
  items: M3Evidence[] | null;
  loading: boolean;
  error: Error | null;
  reload: () => void;
  usage: Map<string, FactorType[]>;
  sourceName: Map<string, string>;
  focused: string | null;
}) {
  if (loading) return <Card><TableSkeleton rows={4} cols={3} /></Card>;
  if (error) return <Card><ErrorState error={error} onRetry={reload} context="evidence" /></Card>;
  if (!items || items.length === 0)
    return (
      <Card>
        <EmptyState
          title="No evidence collected"
          description="Missing evidence is not proof that the entity is legitimate. Attach evidence from the entity record, then run an analysis."
        />
      </Card>
    );
  const foreign = focused && !items.some((item) => item.evidence_id === focused);
  return (
    <div className="space-y-3">
      {foreign ? (
        <p role="status" className="rounded-md border border-evidence/40 bg-evidence/5 px-3 py-2 text-xs text-fg">
          Evidence <span className="font-mono">{shortId(focused)}</span> belongs to a connected entity, not this one. Open it from the
          Connections tab.
        </p>
      ) : null}
      <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <ConceptTag kind="evidence" />
        Observations as stored by the evidence store. Content is untrusted: URLs are shown as text and never opened automatically.
      </p>
      {items.map((item) => (
        <EvidenceCard key={item.evidence_id} item={item} usedIn={usage.get(item.evidence_id) ?? []} source={sourceName.get(item.source_id)} focused={focused === item.evidence_id} />
      ))}
    </div>
  );
}

function EvidenceCard({ item, usedIn, source, focused }: { item: M3Evidence; usedIn: FactorType[]; source?: string; focused: boolean }) {
  const [open, setOpen] = useState(focused);
  useEffect(() => {
    if (focused) setOpen(true);
  }, [focused]);
  const meta = Object.entries(item.metadata ?? {});
  const preview = item.url ?? item.text ?? (item.image_hash ? `image hash ${item.image_hash}` : meta.map(([k, v]) => `${k}: ${String(v)}`).join(", "));
  return (
    <article
      id={`ev-${item.evidence_id}`}
      tabIndex={-1}
      className={cx(
        "rounded-lg border bg-panel px-4 py-3 transition focus:outline-none",
        focused ? "border-evidence ring-1 ring-evidence/50" : "border-line-soft",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="evidence">{EVIDENCE_TYPE_LABEL[item.evidence_type] ?? item.evidence_type}</Badge>
          <span className="text-xs text-muted">{formatDateTime(item.collected_at)}</span>
          <span className="text-xs text-faint">via {source ?? `source ${shortId(item.source_id)}`}</span>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={`ev-body-${item.evidence_id}`}
          className="text-xs text-muted hover:text-fg"
        >
          {open ? "Collapse" : "Expand"}
        </button>
      </div>
      <p className="mt-2 line-clamp-2 break-words text-[13px] text-fg">{preview || "No content recorded."}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="text-faint">Used in</span>
        {usedIn.length ? (
          usedIn.map((f) => (
            <span key={f} className="rounded border border-line px-1.5 py-px text-muted">
              {FACTOR_LABEL[f]}
            </span>
          ))
        ) : (
          <span className="text-faint">no factor of the selected verdict</span>
        )}
      </div>
      {open ? (
        <dl id={`ev-body-${item.evidence_id}`} className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 border-t border-line-soft pt-3 text-xs">
          <dt className="text-faint">Evidence id</dt>
          <dd className="flex items-center gap-2 font-mono text-fg">
            {item.evidence_id}
            <CopyButton value={item.evidence_id} label="evidence id" />
          </dd>
          {item.url ? (
            <>
              <dt className="text-faint">URL</dt>
              <dd className="flex items-center gap-2 break-all font-mono text-fg">
                {item.url}
                <CopyButton value={item.url} label="URL" />
              </dd>
            </>
          ) : null}
          {item.text ? (
            <>
              <dt className="text-faint">Text</dt>
              <dd className="whitespace-pre-wrap break-words text-fg">{item.text}</dd>
            </>
          ) : null}
          {item.image_hash ? (
            <>
              <dt className="text-faint">Image hash</dt>
              <dd className="font-mono text-fg">{item.image_hash}</dd>
            </>
          ) : null}
          {meta.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-faint">{k}</dt>
              <dd className="break-words font-mono text-fg">{typeof v === "string" ? v : JSON.stringify(v)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </article>
  );
}

/* -------------------------------------------------------------------- risk */

function RiskTab({
  threat,
  loading,
  error,
  onCite,
  entityId,
}: {
  threat: ThreatDetail | null;
  loading: boolean;
  error: Error | null;
  onCite: (id: string) => void;
  entityId: string;
}) {
  if (loading) return <Card><TableSkeleton rows={5} cols={2} /></Card>;
  if (error) return <Card><ErrorState error={error} context="the verdict" /></Card>;
  if (!threat)
    return (
      <Card>
        <EmptyState
          title="No risk breakdown yet"
          description="The risk engine produces factor scores when an analysis runs."
          action={
            <Link to={`/analysis/new?entity=${entityId}`} className="rounded-md bg-action px-3 py-1.5 text-xs font-semibold text-on-action">
              Run analysis
            </Link>
          }
        />
      </Card>
    );
  const factors = [...threat.risk_factors].sort((a, b) => b.contribution - a.contribution);
  const present = new Set(factors.map((f) => f.factor_type));
  const absent = ALL_FACTORS.filter((f) => !present.has(f));
  const sum = factors.reduce((n, f) => n + f.contribution, 0);
  return (
    <Card>
      <CardHeader
        title="Risk category breakdown"
        description={`Each factor family's 0–100 score times its engine weight. Contributions sum to about ${sum.toFixed(1)}; the engine reports ${threat.risk_score}.`}
        actions={<ConceptTag kind="risk" />}
      />
      <div className="px-4 pt-4 sm:px-5">
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-white/[0.05]" role="img" aria-label="Share of score by factor">
          {factors.map((f) =>
            f.contribution > 0 ? (
              <div
                key={f.factor_id}
                className={cx("h-full border-r-2 border-ink last:border-r-0", RISK_LEVEL_BAR[scoreLevel(f.score)])}
                style={{ width: `${f.contribution}%` }}
                title={`${FACTOR_LABEL[f.factor_type]}: ${f.contribution.toFixed(1)} points`}
              />
            ) : null,
          )}
        </div>
      </div>
      <ul className="divide-y divide-line-soft">
        {factors.map((f) => (
          <li key={f.factor_id} className="px-4 py-3 sm:px-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-[13px] font-medium text-fg">{FACTOR_LABEL[f.factor_type]}</p>
              <p className="font-mono text-xs text-fg">{f.contribution.toFixed(1)} points</p>
            </div>
            <ScoreBar className="mt-2" value={f.score} level={scoreLevel(f.score)} />
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted">
              <span>score {f.score}/100</span>
              <span>weight {pct(f.weight)}</span>
              <span>confidence {pct(f.confidence)}</span>
              <Badge tone={f.basis === "OBSERVED" ? "evidence" : "ai"}>{f.basis.toLowerCase()}</Badge>
              <span className="flex flex-wrap items-center gap-1">
                {f.evidence_ids.length ? (
                  f.evidence_ids.map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => onCite(id)}
                      className="rounded border border-evidence/40 bg-evidence/10 px-1 font-mono text-[10px] text-evidence hover:border-evidence"
                    >
                      ev {shortId(id)}
                    </button>
                  ))
                ) : (
                  <span className="text-faint">no evidence cited</span>
                )}
              </span>
            </div>
          </li>
        ))}
      </ul>
      <div className="space-y-1.5 border-t border-line-soft px-4 py-3 text-xs text-muted sm:px-5">
        <p>
          Basis: <span className="text-evidence">observed</span> factors are measured from evidence;{" "}
          <span className="text-ai">derived and inferred</span> factors are computed or model-derived from observations.
        </p>
        {absent.length ? (
          <p>No signal recorded for: {absent.map((f) => FACTOR_LABEL[f].toLowerCase()).join(", ")}. Absence of a signal is not evidence of legitimacy.</p>
        ) : null}
        <p>
          Overall confidence {pct(threat.confidence)}, engine v{threat.risk_engine_version}, model {threat.model_version}.
        </p>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------- connections */

function ConnectionsTab({
  entityId,
  hasVerdict,
  items,
  warnings,
  loading,
  error,
  reload,
  onCite,
}: {
  entityId: string;
  hasVerdict: boolean;
  items: RelatedThreatItem[];
  warnings: string[];
  loading: boolean;
  error: Error | null;
  reload: () => void;
  onCite: (id: string) => void;
}) {
  if (!hasVerdict)
    return (
      <Card>
        <EmptyState title="No connections yet" description="Relations are computed between risk-engine verdicts. Run an analysis first." />
      </Card>
    );
  if (loading) return <Card><TableSkeleton rows={3} cols={3} /></Card>;
  if (error) return <Card><ErrorState error={error} onRetry={reload} context="related threats" /></Card>;

  const others = items.filter((r) => r.entity_id !== entityId);
  const self = uniqueBy(items.filter((r) => r.entity_id === entityId), (r) => r.threat_id);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Entities sharing an identifier"
          description="Exact stored-attribute matches from the risk engine (basis EXACT_ATTRIBUTE_MATCH). Look-alike names are never treated as links."
          actions={
            <Link to={`/graph?focus=${entityId}`} className="text-xs font-medium text-action hover:text-fg">
              Open in graph
            </Link>
          }
        />
        {others.length === 0 && warnings.length > 0 ? (
          <EmptyState
            title="Relations could not be fully computed"
            description={`The risk engine reported: ${warnings.slice(0, 2).join(" ")} Unknown is not the same as unconnected.`}
          />
        ) : others.length === 0 ? (
          <EmptyState title="No shared identifiers" description="No other entity in this tenant stores the same domain or handle." />
        ) : (
          <ul className="divide-y divide-line-soft">
            {others.map((r) => (
              <li key={`${r.threat_id}-${r.shared_attribute.key}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
                <div className="min-w-0">
                  <Link to={`/investigate/${r.entity_id}`} className="text-[13px] font-medium text-fg hover:text-action">
                    {r.entity_display_name ?? shortId(r.entity_id)}
                  </Link>
                  <p className="text-xs text-muted">
                    shares {r.shared_attribute.key} <span className="font-mono text-fg">{r.shared_attribute.value}</span>
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone="neutral">{r.relation_type === "SHARED_DOMAIN" ? "Shared domain" : "Shared identifier"}</Badge>
                  {r.target_evidence_ids.slice(0, 2).map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => onCite(id)}
                      title="Evidence on this entity"
                      className="rounded border border-evidence/40 bg-evidence/10 px-1 font-mono text-[10px] text-evidence"
                    >
                      ev {shortId(id)}
                    </button>
                  ))}
                  {r.evidence_ids.slice(0, 2).map((id) => (
                    <Link
                      key={id}
                      to={`/investigate/${r.entity_id}?tab=evidence&ev=${id}`}
                      title="Evidence on the connected entity"
                      className="rounded border border-line px-1 font-mono text-[10px] text-muted hover:text-fg"
                    >
                      their ev {shortId(id)}
                    </Link>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {self.length ? (
        <Card>
          <CardHeader title="Same entity, other brands" description="This entity also has verdicts against other protected brands." />
          <ul className="divide-y divide-line-soft">
            {self.map((r) => (
              <li key={r.threat_id} className="px-4 py-2.5 text-[13px] sm:px-5">
                <Link to={`/threats/${r.threat_id}`} className="text-fg hover:text-action">
                  Verdict {shortId(r.threat_id)}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <p className="text-xs leading-relaxed text-muted">
        Campaign detection is not implemented in the risk engine. Shared identifiers show a possible link for review; they are not a
        confirmed campaign.
        {warnings.length ? ` Warnings from the engine: ${warnings.join(" ")}` : ""}
      </p>
    </div>
  );
}

/* ----------------------------------------------------------------- history */

function HistoryTab({
  entity,
  verdicts,
  brandName,
}: {
  entity: M3Entity;
  verdicts: ThreatSummary[];
  brandName: (uuid: string) => string;
}) {
  const { tenant } = useTenant();
  const jobs = useApi(() => m2.listJobs({ limit: 200 }, tenant), [tenant]);
  const identifier = entity.identifiers.domain ?? entity.identifiers.handle ?? entity.identifiers.package ?? "";
  const scans = useApi(
    () => (identifier ? m1.listScans({ q: identifier, limit: 10 }) : Promise.resolve(null)),
    [identifier],
  );
  const entityJobs = (jobs.data?.items ?? []).filter((j) => j.entity_id === entity.entity_id);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Analysis runs" description="Risk-engine jobs for this entity, newest first. Re-runs update the verdict in place." />
        {jobs.loading ? (
          <TableSkeleton rows={3} cols={3} />
        ) : jobs.error ? (
          <ErrorState error={jobs.error} onRetry={jobs.reload} context="analysis jobs" />
        ) : entityJobs.length === 0 ? (
          <EmptyState title="No analysis runs" description="Runs for this entity appear here." />
        ) : (
          <ul className="divide-y divide-line-soft">
            {entityJobs.map((job) => (
              <li key={job.job_id}>
                <Link to={`/analysis/${job.job_id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-white/[0.03] sm:px-5">
                  <span className="text-[13px] text-fg">
                    vs {brandName(job.brand_id)} <span className="text-xs text-faint">{formatDateTime(job.created_at)}</span>
                  </span>
                  <Badge tone={job.status === "COMPLETED" ? "low" : job.status === "FAILED" ? "critical" : "neutral"}>{JOB_STATUS_LABEL[job.status]}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="Verdicts across brands" description="Current verdict per protected brand." />
        {verdicts.length === 0 ? (
          <EmptyState title="No verdicts" description="No brand has been analysed against this entity yet." />
        ) : (
          <ul className="divide-y divide-line-soft">
            {verdicts.map((v) => (
              <li key={v.threat_id} className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5">
                <Link to={`/threats/${v.threat_id}`} className="text-[13px] text-fg hover:text-action">
                  vs {brandName(v.brand_id)}
                </Link>
                <span className="flex items-center gap-2 text-xs">
                  <span className={cx("font-mono font-bold", RISK_LEVEL_CLASS[v.risk_level])}>{v.risk_score}</span>
                  <span className="text-muted">{formatDateTime(v.analysis_timestamp)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Sentinel scans of this identifier"
          description={identifier ? `Separate scan engine (Module 1). Scans whose target matches “${identifier}”; scores are on Sentinel's own scale.` : "This entity has no identifier to match."}
        />
        {!identifier ? null : scans.loading ? (
          <TableSkeleton rows={2} cols={3} />
        ) : scans.error ? (
          <ErrorState error={scans.error} onRetry={scans.reload} context="Sentinel scans" />
        ) : !scans.data || scans.data.items.length === 0 ? (
          <EmptyState title="No matching Sentinel scans" description="Run a scan from Scans to compare engines." />
        ) : (
          <ul className="divide-y divide-line-soft">
            {scans.data.items.map((scan) => (
              <li key={scan.id}>
                <Link to={`/scans/${scan.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-white/[0.03] sm:px-5">
                  <span className="min-w-0 truncate font-mono text-xs text-fg">{scan.target}</span>
                  <span className="shrink-0 text-xs text-muted">
                    {scan.riskScore} {M1_RISK_LEVEL_LABEL[scan.riskLevel]}, {formatDateTime(scan.createdAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
