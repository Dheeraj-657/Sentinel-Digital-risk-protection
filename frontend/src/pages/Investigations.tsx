import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { m2, m3 } from "../lib/api";
import { useApi } from "../lib/hooks";
import { useTenant } from "../lib/tenant";
import { cx, ENTITY_TYPE_LABEL, RISK_LEVEL_CLASS, RISK_LEVEL_LABEL } from "../lib/format";
import { Card, EmptyState, ErrorState, PageHeader, TableSkeleton } from "../components/ui";
import type { M3EntityType, ThreatSummary } from "../lib/types";

const TYPES: M3EntityType[] = ["SOCIAL_PROFILE", "WEBSITE", "DOMAIN", "MOBILE_APP", "MESSAGING_ACCOUNT", "OTHER"];

/** Entry point to the investigation workspace: every entity, ranked by its highest verdict. */
export function Investigations() {
  const { tenant } = useTenant();
  const [params, setParams] = useSearchParams();
  const type = (params.get("type") ?? "") as M3EntityType | "";
  const q = params.get("q") ?? "";
  const scope = params.get("scope") ?? "all";

  const entities = useApi(() => m3.listEntities({ limit: 200, entity_type: type || undefined }, tenant), [tenant, type]);
  const threats = useApi(() => m2.listThreats({ limit: 200 }, tenant), [tenant]);

  const rows = useMemo(() => {
    const byEntity = new Map<string, ThreatSummary[]>();
    for (const t of threats.data?.items ?? []) {
      byEntity.set(t.entity_id, [...(byEntity.get(t.entity_id) ?? []), t]);
    }
    const needle = q.trim().toLowerCase();
    return (entities.data?.items ?? [])
      .map((entity) => {
        const verdicts = byEntity.get(entity.entity_id) ?? [];
        const top = [...verdicts].sort((a, b) => b.risk_score - a.risk_score)[0];
        return { entity, verdicts, top, open: verdicts.filter((v) => v.status === "OPEN").length };
      })
      .filter((row) =>
        !needle
          ? true
          : [row.entity.display_name, row.entity.entity_id, ...Object.values(row.entity.identifiers)].some((v) =>
              v?.toLowerCase().includes(needle),
            ),
      )
      .filter((row) => (scope === "unscored" ? !row.top : scope === "scored" ? !!row.top : true))
      .sort((a, b) => (b.top?.risk_score ?? -1) - (a.top?.risk_score ?? -1));
  }, [entities.data, threats.data, q, scope]);

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader
        title="Investigations"
        description="Open any entity in the unified workspace: evidence, the risk engine's verdict, connected entities and the AI Security Analyst in one place."
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label htmlFor="inv-q" className="sr-only">Filter entities</label>
        <input
          id="inv-q"
          value={q}
          onChange={(e) => update("q", e.target.value)}
          placeholder="Filter by name, domain, handle or id"
          className="w-full rounded-md border border-line bg-ink/50 px-3 py-1.5 sm:w-72 text-[13px] placeholder:text-faint focus:border-action/60 focus:outline-none"
        />
        <label htmlFor="inv-type" className="sr-only">Entity type</label>
        <select id="inv-type" value={type} onChange={(e) => update("type", e.target.value)} className="rounded-md border border-line bg-ink/50 px-2 py-1.5 text-[13px]">
          <option value="">All entity types</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>{ENTITY_TYPE_LABEL[t]}</option>
          ))}
        </select>
        <div role="radiogroup" aria-label="Verdict filter" className="flex rounded-md border border-line p-0.5">
          {[
            ["all", "All"],
            ["scored", "With verdict"],
            ["unscored", "Not analysed"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={scope === value}
              onClick={() => update("scope", value === "all" ? "" : value)}
              className={cx("rounded px-2.5 py-1 text-xs", scope === value ? "bg-white/[0.08] text-fg" : "text-muted hover:text-fg")}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <Card>
        {entities.loading || threats.loading ? (
          <TableSkeleton rows={5} cols={4} />
        ) : entities.error ? (
          <ErrorState error={entities.error} onRetry={entities.reload} context="entities" />
        ) : rows.length === 0 ? (
          <EmptyState
            title={entities.data?.items.length ? "No entities match the filters" : "No entities yet"}
            description="Entities come from the evidence store: register one, or run discovery from a protected brand."
            action={
              <Link to="/entities" className="rounded-md border border-line px-3 py-1.5 text-xs text-fg hover:border-action/60">
                Go to entities
              </Link>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-left text-[13px]">
              <thead>
                <tr className="border-b border-line-soft text-xs text-faint">
                  <th scope="col" className="px-4 py-2.5 font-medium sm:px-5">Highest verdict</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Entity</th>
                  <th scope="col" className="hidden px-4 py-2.5 font-medium md:table-cell">Identifiers</th>
                  <th scope="col" className="hidden px-4 py-2.5 font-medium sm:table-cell">Verdicts</th>
                  <th scope="col" className="px-4 py-2.5 font-medium"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {rows.map(({ entity, verdicts, top, open }) => (
                  <tr key={entity.entity_id} className="hover:bg-white/[0.03]">
                    <td className="whitespace-nowrap px-4 py-2.5 sm:px-5">
                      {top ? (
                        <span className="flex items-center gap-2">
                          <span className={cx("font-condensed font-mono text-xl font-bold leading-none", RISK_LEVEL_CLASS[top.risk_level])}>
                            {top.risk_score}
                          </span>
                          <span className="text-xs text-muted">{RISK_LEVEL_LABEL[top.risk_level]}</span>
                        </span>
                      ) : (
                        <span className="text-xs text-faint">Not analysed</span>
                      )}
                    </td>
                    <td className="max-w-64 px-4 py-2.5">
                      <Link to={`/investigate/${entity.entity_id}`} className="block truncate font-medium text-fg hover:text-action">
                        {entity.display_name ?? entity.entity_id}
                      </Link>
                      <span className="text-xs text-faint">{ENTITY_TYPE_LABEL[entity.entity_type]}</span>
                    </td>
                    <td className="hidden max-w-72 truncate px-4 py-2.5 font-mono text-xs text-muted md:table-cell">
                      {Object.values(entity.identifiers).join(", ") || "None"}
                    </td>
                    <td className="hidden px-4 py-2.5 text-xs text-muted sm:table-cell">
                      {verdicts.length ? `${verdicts.length} (${open} open)` : "0"}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Link
                        to={`/investigate/${entity.entity_id}`}
                        className="rounded-md border border-line px-2.5 py-1 text-xs text-fg hover:border-action/60"
                        aria-label={`Investigate ${entity.display_name ?? entity.entity_id}`}
                      >
                        Investigate
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {(threats.data?.total ?? 0) > 200 ? (
        <p className="mt-2 text-xs text-faint">Verdicts beyond the 200 highest-risk are not ranked here.</p>
      ) : null}
      {threats.error ? <p className="mt-2 text-xs text-risk-medium">Risk engine unavailable: verdict columns are empty, not zero.</p> : null}
    </>
  );
}
