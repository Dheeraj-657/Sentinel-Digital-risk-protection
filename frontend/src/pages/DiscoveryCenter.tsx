import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { m1, m2, m3 } from "../lib/api";
import { errorMessage, useApi } from "../lib/hooks";
import { useTenant } from "../lib/tenant";
import { brandUuidFromCuid, findBrandForUuid } from "../lib/brand-bridge";
import {
  cx,
  DISCOVERY_JOB_STATUS_LABEL,
  DISCOVERY_JOB_STATUS_TONE,
  DISCOVERY_PROVIDER_STATUS_LABEL,
  DISCOVERY_PROVIDER_STATUS_TONE,
  ENTITY_TYPE_LABEL,
  formatDateTime,
  RISK_LEVEL_CLASS,
  RISK_LEVEL_LABEL,
  shortId,
} from "../lib/format";
import { Badge, Card, CardHeader, EmptyState, ErrorState, PageHeader, TableSkeleton } from "../components/ui";
import type { DiscoveryJobStatus, M3EntityType, ThreatSummary } from "../lib/types";

const TYPES: M3EntityType[] = ["WEBSITE", "DOMAIN", "SOCIAL_PROFILE", "MOBILE_APP", "MESSAGING_ACCOUNT", "OTHER"];
const STATUSES: DiscoveryJobStatus[] = ["QUEUED", "RUNNING", "COMPLETED", "PARTIAL", "FAILED"];

/**
 * Discovery Center — one place for the existing discovery pipeline (Module 2)
 * and the entities it and analysts registered (Module 3). The console starts
 * discovery through the existing API; it never scrapes or collects itself.
 */
export function DiscoveryCenter() {
  const { tenant } = useTenant();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const jobStatus = (params.get("status") ?? "") as DiscoveryJobStatus | "";
  const type = (params.get("type") ?? "") as M3EntityType | "";
  const origin = params.get("origin") ?? "";
  const verdict = params.get("verdict") ?? "";
  const q = params.get("q") ?? "";

  const brands = useApi(() => m1.listBrands(), []);
  const jobs = useApi(() => m2.listDiscovery({ status: jobStatus || undefined, limit: 50 }, tenant), [tenant, jobStatus]);
  const latestId = jobs.data?.items?.[0]?.job_id ?? null;
  const latest = useApi(() => (latestId ? m2.getDiscovery(latestId, tenant) : Promise.resolve(null)), [tenant, latestId]);
  const entities = useApi(
    () => m3.listEntities({ limit: 200, entity_type: type || undefined, q: q.trim() || undefined }, tenant),
    [tenant, type, q],
  );
  const threats = useApi(() => m2.listThreats({ limit: 200 }, tenant), [tenant]);

  const [brandId, setBrandId] = useState("");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const brandName = (uuid: string) => findBrandForUuid(brands.data?.items ?? [], uuid)?.name ?? `Brand ${shortId(uuid)}`;

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const start = async () => {
    if (!brandId || starting) return;
    setStarting(true);
    setStartError(null);
    try {
      const job = await m2.createDiscovery(brandUuidFromCuid(brandId), tenant);
      navigate(`/discovery/${job.job_id}`);
    } catch (err) {
      setStartError(errorMessage(err));
      setStarting(false);
    }
  };

  const verdictByEntity = useMemo(() => {
    const map = new Map<string, ThreatSummary>();
    for (const t of threats.data?.items ?? []) {
      const prev = map.get(t.entity_id);
      if (!prev || t.risk_score > prev.risk_score) map.set(t.entity_id, t);
    }
    return map;
  }, [threats.data]);

  const rows = (entities.data?.items ?? []).filter((e) => {
    const discovered = e.attributes?.origin === "discovery";
    if (origin === "discovery" && !discovered) return false;
    if (origin === "manual" && discovered) return false;
    const v = verdictByEntity.get(e.entity_id);
    if (verdict === "scored" && !v) return false;
    if (verdict === "unscored" && v) return false;
    return true;
  });

  return (
    <>
      <PageHeader
        title="Discovery"
        description="Find candidate impersonations from a protected brand's DNA, then inspect what was found. Discovery queries public Certificate Transparency logs and, when configured, web search. Provider outages are reported, never masked."
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Start discovery" description="Runs the existing Module 2 discovery job for one brand. Candidates are stored as evidence and scored automatically." />
          <div className="flex flex-wrap items-end gap-2 px-4 py-4 sm:px-5">
            <div className="min-w-56 flex-1">
              <label htmlFor="disc-brand" className="mb-1 block text-xs text-muted">Protected brand</label>
              <select
                id="disc-brand"
                value={brandId}
                onChange={(e) => setBrandId(e.target.value)}
                disabled={brands.loading || !!brands.error}
                className="w-full rounded-md border border-line bg-ink/50 px-2 py-1.5 text-[13px]"
              >
                <option value="">{brands.loading ? "Loading brands…" : brands.error ? "Brand registry unavailable" : "Choose a brand"}</option>
                {(brands.data?.items ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.officialDomains.join(", ") || "no domains"})
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={start}
              disabled={!brandId || starting}
              className="rounded-md bg-action px-3 py-1.5 text-[13px] font-semibold text-on-action transition hover:bg-action-strong disabled:cursor-not-allowed disabled:opacity-40"
            >
              {starting ? "Starting…" : "Discover threats"}
            </button>
            {startError ? <p role="alert" className="w-full text-xs text-risk-critical">{startError}</p> : null}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Provider status"
            description={latest.data ? `From the most recent run (${formatDateTime(latest.data.created_at)}).` : "Per-provider outcome of the most recent discovery run."}
          />
          {latest.loading || jobs.loading ? (
            <TableSkeleton rows={3} cols={3} />
          ) : !latest.data ? (
            <p className="px-4 py-4 text-[13px] text-muted sm:px-5">No discovery has run yet, so no provider has been exercised.</p>
          ) : (
            <ul className="divide-y divide-line-soft">
              {latest.data.provider_outcomes.map((p) => (
                <li key={p.provider} className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5">
                  <span className="min-w-0">
                    <span className="block font-mono text-xs text-fg">{p.provider}</span>
                    {p.error || p.warning ? <span className="block truncate text-[11px] text-faint">{p.error ?? p.warning}</span> : null}
                  </span>
                  <span className="flex items-center gap-2 text-xs text-muted">
                    {p.latency_ms !== null ? `${p.latency_ms} ms` : null}
                    <Badge tone={DISCOVERY_PROVIDER_STATUS_TONE[p.status]}>{DISCOVERY_PROVIDER_STATUS_LABEL[p.status]}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader
          title="Discovery runs"
          actions={
            <select
              aria-label="Filter runs by status"
              value={jobStatus}
              onChange={(e) => update("status", e.target.value)}
              className="rounded-md border border-line bg-ink/50 px-2 py-1 text-xs"
            >
              <option value="">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{DISCOVERY_JOB_STATUS_LABEL[s]}</option>
              ))}
            </select>
          }
        />
        {jobs.loading ? (
          <TableSkeleton rows={3} cols={4} />
        ) : jobs.error ? (
          <ErrorState error={jobs.error} onRetry={jobs.reload} context="discovery runs" />
        ) : !jobs.data || jobs.data.items.length === 0 ? (
          <EmptyState title={jobStatus ? "No runs with this status" : "No discovery runs yet"} description="Start one above." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line-soft text-xs text-faint">
                  <th scope="col" className="px-4 py-2.5 font-medium sm:px-5">Brand</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Status</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Candidates</th>
                  <th scope="col" className="hidden px-4 py-2.5 font-medium md:table-cell">Duplicates removed</th>
                  <th scope="col" className="hidden px-4 py-2.5 font-medium sm:table-cell">Started</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {jobs.data.items.map((job) => (
                  <tr key={job.job_id} className="hover:bg-white/[0.03]">
                    <td className="px-4 py-2.5 sm:px-5">
                      <Link to={`/discovery/${job.job_id}`} className="text-fg hover:text-action">{brandName(job.brand_id)}</Link>
                      {job.error_code ? <span className="block font-mono text-[11px] text-faint">{job.error_code}</span> : null}
                    </td>
                    <td className="px-4 py-2.5"><Badge tone={DISCOVERY_JOB_STATUS_TONE[job.status]}>{DISCOVERY_JOB_STATUS_LABEL[job.status]}</Badge></td>
                    <td className="px-4 py-2.5 font-mono text-xs">{job.candidate_count}</td>
                    <td className="hidden px-4 py-2.5 font-mono text-xs text-muted md:table-cell">{job.duplicate_count}</td>
                    <td className="hidden whitespace-nowrap px-4 py-2.5 text-xs text-muted sm:table-cell">{formatDateTime(job.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="mt-4">
        <CardHeader
          title="Discovered and registered entities"
          description="Every entity in the evidence store, with where it came from and whether the risk engine has scored it."
        />
        <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-3 sm:px-5">
          <label htmlFor="disc-q" className="sr-only">Search entities</label>
          <input
            id="disc-q"
            value={q}
            onChange={(e) => update("q", e.target.value)}
            placeholder="Search name or identifier"
            className="w-60 max-w-full rounded-md border border-line bg-ink/50 px-2.5 py-1 text-[13px] placeholder:text-faint"
          />
          <select aria-label="Entity type" value={type} onChange={(e) => update("type", e.target.value)} className="rounded-md border border-line bg-ink/50 px-2 py-1 text-xs">
            <option value="">All types</option>
            {TYPES.map((t) => <option key={t} value={t}>{ENTITY_TYPE_LABEL[t]}</option>)}
          </select>
          <select aria-label="Collection source" value={origin} onChange={(e) => update("origin", e.target.value)} className="rounded-md border border-line bg-ink/50 px-2 py-1 text-xs">
            <option value="">Any source</option>
            <option value="discovery">Automatic discovery</option>
            <option value="manual">Manual registration</option>
          </select>
          <select aria-label="Analysis status" value={verdict} onChange={(e) => update("verdict", e.target.value)} className="rounded-md border border-line bg-ink/50 px-2 py-1 text-xs">
            <option value="">Any analysis status</option>
            <option value="scored">Scored</option>
            <option value="unscored">Not analysed</option>
          </select>
        </div>
        {entities.loading ? (
          <TableSkeleton rows={4} cols={4} />
        ) : entities.error ? (
          <ErrorState error={entities.error} onRetry={entities.reload} context="entities" />
        ) : rows.length === 0 ? (
          <EmptyState title="No entities match" description="Clear a filter, or run discovery for a brand." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line-soft text-xs text-faint">
                  <th scope="col" className="px-4 py-2.5 font-medium sm:px-5">Entity</th>
                  <th scope="col" className="hidden px-4 py-2.5 font-medium md:table-cell">Identifiers</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Source</th>
                  <th scope="col" className="hidden px-4 py-2.5 font-medium lg:table-cell">Registered</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Verdict</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {rows.map((e) => {
                  const v = verdictByEntity.get(e.entity_id);
                  const job = typeof e.attributes?.discovery_job_id === "string" ? (e.attributes.discovery_job_id as string) : null;
                  return (
                    <tr key={e.entity_id} className="hover:bg-white/[0.03]">
                      <td className="max-w-64 px-4 py-2.5 sm:px-5">
                        <Link to={`/investigate/${e.entity_id}`} className="block truncate text-fg hover:text-action">{e.display_name ?? shortId(e.entity_id)}</Link>
                        <span className="text-[11px] text-faint">{ENTITY_TYPE_LABEL[e.entity_type]}</span>
                      </td>
                      <td className="hidden max-w-64 truncate px-4 py-2.5 font-mono text-xs text-muted md:table-cell">
                        {Object.values(e.identifiers).join(", ") || "None"}
                      </td>
                      <td className="px-4 py-2.5 text-xs">
                        {job ? (
                          <Link to={`/discovery/${job}`} className="text-action hover:text-fg">Discovery run {shortId(job)}</Link>
                        ) : (
                          <span className="text-muted">Manual</span>
                        )}
                      </td>
                      <td className="hidden whitespace-nowrap px-4 py-2.5 text-xs text-muted lg:table-cell">{formatDateTime(e.created_at)}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs">
                        {v ? (
                          <span className={cx("font-semibold", RISK_LEVEL_CLASS[v.risk_level])}>{v.risk_score} {RISK_LEVEL_LABEL[v.risk_level]}</span>
                        ) : threats.error ? (
                          <span className="text-faint">Unknown</span>
                        ) : (
                          <Link to={`/analysis/new?entity=${e.entity_id}`} className="text-muted hover:text-fg">Not analysed</Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
