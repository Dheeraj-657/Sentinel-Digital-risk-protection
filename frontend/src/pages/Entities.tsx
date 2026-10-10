import { useState } from "react";
import { Link } from "react-router-dom";
import { useApi, errorMessage } from "../lib/hooks";
import { m3 } from "../lib/api";
import { useTenant } from "../lib/tenant";
import { ENTITY_TYPE_LABEL, formatDateTime } from "../lib/format";
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  PageHeader,
  TableSkeleton,
} from "../components/ui";
import type { M3EntityType } from "../lib/types";

const ENTITY_TYPES: M3EntityType[] = [
  "WEBSITE",
  "SOCIAL_PROFILE",
  "DOMAIN",
  "MOBILE_APP",
  "MESSAGING_ACCOUNT",
  "OTHER",
];

const filterSelect =
  "rounded border border-line bg-ink px-2 py-1.5 text-xs text-fg focus:border-action/60 focus:outline-none";

export function Entities() {
  const { tenant } = useTenant();
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<M3EntityType | "">("");
  const entities = useApi(
    () =>
      m3.listEntities(
        { entity_type: typeFilter || undefined, q: query || undefined, limit: 200 },
        tenant,
      ),
    [tenant, query, typeFilter],
  );
  const [formOpen, setFormOpen] = useState(false);

  const hasFilters = query !== "" || typeFilter !== "";

  const resetFilters = () => {
    setQuery("");
    setTypeFilter("");
  };

  return (
    <>
      <PageHeader
        title="Entities"
        description="Discovered digital entities with their attached evidence. Entities are the unit of analysis — pick one and run it through the risk engine."
        actions={
          <Button variant="primary" onClick={() => setFormOpen((open) => !open)}>
            {formOpen ? "Close" : "Register entity"}
          </Button>
        }
      />

      {formOpen ? (
        <RegisterEntityCard
          onCreated={() => {
            setFormOpen(false);
            entities.reload();
          }}
        />
      ) : null}

      <Card className="mt-4">
        <CardHeader
          title="Entity register"
          description={
            entities.data
              ? `${entities.data.total} entit${entities.data.total === 1 ? "y" : "ies"} in tenant — newest first`
              : undefined
          }
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <form
                onSubmit={(event) => event.preventDefault()}
                className="flex items-center gap-2"
              >
                <label className="sr-only" htmlFor="entity-search">
                  Search entities
                </label>
                <input
                  id="entity-search"
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search name or identifier…"
                  spellCheck={false}
                  className="w-52 rounded border border-line bg-ink px-2.5 py-1.5 text-xs text-fg placeholder:text-faint focus:border-action/60 focus:outline-none"
                />
              </form>
              <select
                aria-label="Filter by entity type"
                value={typeFilter}
                onChange={(event) => setTypeFilter(event.target.value as M3EntityType | "")}
                className={filterSelect}
              >
                <option value="">All types</option>
                {ENTITY_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {ENTITY_TYPE_LABEL[type]}
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
        {entities.loading ? (
          <TableSkeleton rows={5} />
        ) : entities.error ? (
          <ErrorState error={entities.error} onRetry={entities.reload} context="entities" />
        ) : !entities.data || entities.data.items.length === 0 ? (
          <EmptyState
            title={hasFilters ? "No entities match the filters" : "No entities yet"}
            description={
              hasFilters
                ? "Adjust or clear the filters to see more results."
                : "Register a discovered entity (website, profile, domain…) and attach evidence to it, then run an analysis."
            }
            action={
              hasFilters ? (
                <Button onClick={resetFilters}>Clear filters</Button>
              ) : (
                <Button variant="primary" onClick={() => setFormOpen(true)}>
                  Register entity
                </Button>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line-soft text-[11px] text-faint">
                  <th scope="col" className="px-4 py-2.5 font-medium sm:px-5">
                    Entity
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Type
                  </th>
                  <th scope="col" className="hidden px-4 py-2.5 font-medium sm:table-cell">
                    Identifiers
                  </th>
                  <th scope="col" className="hidden px-4 py-2.5 font-medium lg:table-cell">
                    Registered
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {entities.data.items.map((entity) => (
                  <tr key={entity.entity_id} className="group transition hover:bg-raised/50">
                    <td className="px-4 py-3 sm:px-5">
                      <Link
                        to={`/entities/${entity.entity_id}`}
                        className="text-fg hover:text-action"
                      >
                        {entity.display_name ?? entity.entity_id.slice(0, 8) + "…"}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">
                      {ENTITY_TYPE_LABEL[entity.entity_type] ?? entity.entity_type}
                    </td>
                    <td className="hidden max-w-72 truncate px-4 py-3 font-mono text-xs text-faint sm:table-cell">
                      {identifierSummary(entity.identifiers)}
                    </td>
                    <td className="hidden whitespace-nowrap px-4 py-3 text-xs text-muted lg:table-cell">
                      {formatDateTime(entity.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="mt-3 text-[11px] leading-relaxed text-faint">
        Entities registered from synthetic fixtures are labelled SYNTHETIC TEST_ONLY in their names.
        The console never fabricates discovery results — live discovery happens in Sentinel DRP.
      </p>
    </>
  );
}

function identifierSummary(identifiers: Record<string, string>): string {
  const entries = Object.entries(identifiers);
  if (entries.length === 0) return "—";
  return entries.map(([key, value]) => `${key}: ${value}`).join(" · ");
}

const inputClass =
  "w-full rounded border border-line bg-ink px-2.5 py-1.5 text-sm text-fg placeholder:text-faint focus:border-action/60 focus:outline-none";

export function RegisterEntityCard({ onCreated }: { onCreated: () => void }) {
  const { tenant } = useTenant();
  const [entityType, setEntityType] = useState<M3EntityType>("WEBSITE");
  const [displayName, setDisplayName] = useState("");
  const [domain, setDomain] = useState("");
  const [handle, setHandle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!displayName.trim()) {
      setError("A display name is required.");
      return;
    }
    if (!domain.trim() && !handle.trim()) {
      setError("Provide at least one identifier (domain or handle).");
      return;
    }
    const identifiers: Record<string, string> = {};
    if (domain.trim()) identifiers.domain = domain.trim().toLowerCase();
    if (handle.trim()) identifiers.handle = handle.trim().toLowerCase();
    setSaving(true);
    setError(null);
    try {
      await m3.createEntity(
        {
          entity_type: entityType,
          display_name: displayName.trim(),
          identifiers,
        },
        tenant,
      );
      setDisplayName("");
      setDomain("");
      setHandle("");
      onCreated();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Register a discovered entity"
        description="Creates a normalized entity in the evidence store. Use it for entities surfaced by Sentinel DRP or for clearly labelled test fixtures."
      />
      <form onSubmit={submit} className="space-y-4 px-4 py-4 sm:px-5" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="entity-type" className="block text-[11px] font-medium text-faint">
              Type
            </label>
            <select
              id="entity-type"
              value={entityType}
              onChange={(event) => setEntityType(event.target.value as M3EntityType)}
              className={inputClass}
            >
              {ENTITY_TYPES.map((type) => (
                <option key={type} value={type}>
                  {ENTITY_TYPE_LABEL[type]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="entity-name" className="block text-[11px] font-medium text-faint">
              Display name <span className="text-risk-medium">*</span>
            </label>
            <input
              id="entity-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="e.g. Acme Corp Support — SYNTHETIC TEST_ONLY"
              className={inputClass}
              aria-required="true"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="entity-domain" className="block text-[11px] font-medium text-faint">
              Domain
            </label>
            <input
              id="entity-domain"
              value={domain}
              onChange={(event) => setDomain(event.target.value)}
              placeholder="support-acme.example"
              spellCheck={false}
              className={inputClass}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="entity-handle" className="block text-[11px] font-medium text-faint">
              Handle
            </label>
            <input
              id="entity-handle"
              value={handle}
              onChange={(event) => setHandle(event.target.value)}
              placeholder="@acme_help"
              spellCheck={false}
              className={inputClass}
            />
          </div>
        </div>
        {error ? (
          <p role="alert" className="text-xs text-risk-medium">
            {error}
          </p>
        ) : null}
        <div className="flex items-center gap-2">
          <Button variant="primary" type="submit" disabled={saving}>
            {saving ? "Saving…" : "Register entity"}
          </Button>
          <span className="text-[11px] text-faint">
            Identifiers are normalized (lowercased, trimmed) on ingest.
          </span>
        </div>
      </form>
    </Card>
  );
}
