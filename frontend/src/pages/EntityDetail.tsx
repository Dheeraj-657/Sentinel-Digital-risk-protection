import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useApi, errorMessage } from "../lib/hooks";
import { m2, m3 } from "../lib/api";
import { useTenant } from "../lib/tenant";
import { ENTITY_TYPE_LABEL, EVIDENCE_TYPE_LABEL, cx, formatDateTime } from "../lib/format";
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
  StatCard,
} from "../components/ui";
import { ThreatTable } from "../components/threat-table";
import type { M3Entity, M3EvidenceType } from "../lib/types";

const EVIDENCE_TYPES: M3EvidenceType[] = [
  "IDENTITY_MATCH",
  "TEXT_CONTENT",
  "VISUAL_ASSET",
  "DOMAIN_INTEL",
  "BEHAVIORAL_EVENT",
  "REPUTATION_INTEL",
  "RELATIONSHIP_LINK",
];

export function EntityDetail() {
  const { entityId = "" } = useParams();
  const { tenant } = useTenant();
  const entity = useApi(() => m3.getEntity(entityId, tenant), [tenant, entityId]);
  const evidence = useApi(() => m3.listEvidence(entityId, tenant), [tenant, entityId]);
  const sources = useApi(() => m3.listSources({ limit: 200 }, tenant), [tenant]);
  const threats = useApi(() => m2.listThreats({ limit: 200 }, tenant), [tenant]);
  const [formOpen, setFormOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  if (entity.loading) {
    return (
      <>
        <PageHeader title="Entity" />
        <Card className="px-4 py-3.5">
          <div className="animate-pulse space-y-3">
            <div className="h-6 w-56 rounded bg-raised" />
            <div className="h-4 w-72 rounded bg-raised" />
          </div>
        </Card>
      </>
    );
  }

  if (entity.error) {
    return (
      <Card>
        <ErrorState
          error={entity.error}
          onRetry={entity.reload}
          context="entity"
        />
      </Card>
    );
  }

  const data = entity.data!;
  const evidenceItems = evidence.data ?? [];
  const sourceMap = new Map(
    (sources.data?.items ?? []).map((source) => [source.source_id, source]),
  );
  const entityThreats = (threats.data?.items ?? []).filter(
    (threat) => threat.entity_id === entityId,
  );

  return (
    <>
      <PageHeader
        title={data.display_name ?? "Entity"}
        description="Discovered entity with its evidence trail and risk-engine verdicts."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" onClick={() => setEditOpen((open) => !open)}>
              {editOpen ? "Close editor" : "Edit entity"}
            </Button>
            <Link to={`/analysis/new?entity=${encodeURIComponent(entityId)}`}>
              <Button>Run analysis</Button>
            </Link>
            <Link
              to={`/investigate/${encodeURIComponent(entityId)}`}
              className="rounded-md border border-line bg-raised/70 px-3 py-1.5 text-[13px] font-medium text-fg transition hover:border-action/60"
            >
              Open investigation
            </Link>
          </div>
        }
      />

      {editOpen ? (
        <EditEntityCard
          entity={data}
          onSaved={() => {
            setEditOpen(false);
            entity.reload();
          }}
          onCancel={() => setEditOpen(false)}
        />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Evidence items" value={evidenceItems.length} />
        <StatCard label="Threats" value={entityThreats.length} />
        <StatCard
          label="Highest risk"
          value={
            entityThreats.length > 0
              ? Math.round(Math.max(...entityThreats.map((threat) => threat.risk_score)))
              : "—"
          }
          tone={entityThreats.length > 0 ? "high" : "neutral"}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Identity" />
          <dl className="grid grid-cols-2 gap-4 px-4 py-4 sm:px-5">
            <KeyValue label="Type">
              {ENTITY_TYPE_LABEL[data.entity_type] ?? data.entity_type}
            </KeyValue>
            <KeyValue label="Entity ID" mono>
              {data.entity_id}
            </KeyValue>
            <div className="col-span-2">
              <KeyValue label="Identifiers">
                {Object.keys(data.identifiers).length === 0 ? (
                  <span className="text-xs text-faint">None</span>
                ) : (
                  <span className="flex flex-wrap gap-1">
                    {Object.entries(data.identifiers).map(([key, value]) => (
                      <Chip key={key}>
                        {key}: {value}
                      </Chip>
                    ))}
                  </span>
                )}
              </KeyValue>
            </div>
            {Object.keys(data.attributes).length > 0 ? (
              <div className="col-span-2">
                <KeyValue label="Attributes">
                  <span className="flex flex-wrap gap-1">
                    {Object.entries(data.attributes).map(([key, value]) => (
                      <Chip key={key}>
                        {key}: {String(value)}
                      </Chip>
                    ))}
                  </span>
                </KeyValue>
              </div>
            ) : null}
          </dl>
        </Card>

        <Card>
          <CardHeader
            title="Sources of its evidence"
            description="Provenance registry entries cited by this entity's evidence."
          />
          {sources.loading ? (
            <div className="px-4 py-4 text-xs text-faint sm:px-5">Loading sources…</div>
          ) : sourceMap.size === 0 ? (
            <EmptyState
              title="No sources registered"
              description="Register a source before attaching evidence so every item carries provenance."
            />
          ) : (
            <ul className="divide-y divide-line-soft">
              {Array.from(sourceMap.values()).map((source) => (
                <li key={source.source_id} className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5">
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-fg">{source.name}</span>
                    <span className="text-[11px] text-faint">
                      {source.kind} · {formatDateTime(source.created_at)}
                    </span>
                  </span>
                  <Badge tone="evidence">
                    {evidenceItems.filter((item) => item.source_id === source.source_id).length}{" "}
                    item{evidenceItems.filter((item) => item.source_id === source.source_id).length === 1 ? "" : "s"}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader
          title="Evidence timeline"
          description={`${evidenceItems.length} item${evidenceItems.length === 1 ? "" : "s"} — oldest first.`}
          actions={
            <Button variant="primary" onClick={() => setFormOpen((open) => !open)}>
              {formOpen ? "Close" : "Attach evidence"}
            </Button>
          }
        />
        {formOpen ? (
          <AttachEvidenceForm
            entityId={entityId}
            sources={Array.from(sourceMap.values())}
            onAttached={() => {
              evidence.reload();
              sources.reload();
            }}
          />
        ) : null}
        {evidence.loading ? (
          <div className="px-4 py-4 text-xs text-faint sm:px-5">Loading evidence…</div>
        ) : evidence.error ? (
          <ErrorState error={evidence.error} onRetry={evidence.reload} context="evidence" />
        ) : evidenceItems.length === 0 ? (
          <EmptyState
            title="No evidence attached"
            description="Attach evidence (text, visual hash, domain intel, behavioral events) so the risk engine has something to score."
            action={
              <Button variant="primary" onClick={() => setFormOpen(true)}>
                Attach evidence
              </Button>
            }
          />
        ) : (
          <ol className="divide-y divide-line-soft">
            {evidenceItems.map((item) => (
              <li key={item.evidence_id} className="px-4 py-3.5 sm:px-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="evidence">
                    {EVIDENCE_TYPE_LABEL[item.evidence_type] ?? item.evidence_type}
                  </Badge>
                  <span className="text-xs text-faint">
                    via <span className="text-muted">{sourceMap.get(item.source_id)?.name ?? "unknown source"}</span>
                  </span>
                  <span className="text-xs text-faint">· {formatDateTime(item.collected_at)}</span>
                </div>
                <dl className="mt-1.5 space-y-1 text-xs">
                  {item.text ? (
                    <div>
                      <dt className="sr-only">Text</dt>
                      <dd className="text-muted">&ldquo;{item.text}&rdquo;</dd>
                    </div>
                  ) : null}
                  {item.url ? (
                    <div className="flex gap-2">
                      <dt className="text-faint">URL</dt>
                      <dd className="min-w-0 break-all font-mono text-[11px] text-action">{item.url}</dd>
                    </div>
                  ) : null}
                  {item.image_hash ? (
                    <div className="flex gap-2">
                      <dt className="text-faint">Image hash</dt>
                      <dd className="font-mono text-[11px] text-muted">{item.image_hash}</dd>
                    </div>
                  ) : null}
                  {Object.keys(item.metadata).length > 0 ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <dt className="text-faint">Metadata</dt>
                      <dd className="flex flex-wrap gap-1">
                        {Object.entries(item.metadata).map(([key, value]) => (
                          <Chip key={key}>
                            {key}: {String(value)}
                          </Chip>
                        ))}
                      </dd>
                    </div>
                  ) : null}
                </dl>
                <p className="mt-1.5 font-mono text-[10px] text-faint">{item.evidence_id}</p>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Card className="mt-4">
        <CardHeader
          title="Threats for this entity"
          description="Risk-engine verdicts that scored this entity."
        />
        {threats.loading ? (
          <div className="px-4 py-4 text-xs text-faint sm:px-5">Loading threats…</div>
        ) : threats.error ? (
          <ErrorState error={threats.error} onRetry={threats.reload} context="threats" />
        ) : entityThreats.length === 0 ? (
          <EmptyState
            title="Not analyzed yet"
            description="Run this entity through the risk engine to produce a scored threat."
            action={
              <Link to={`/analysis/new?entity=${encodeURIComponent(entityId)}`}>
                <Button variant="primary">Run analysis</Button>
              </Link>
            }
          />
        ) : (
          <ThreatTable threats={entityThreats} />
        )}
      </Card>
    </>
  );
}

const inputClass =
  "w-full rounded border border-line bg-ink px-2.5 py-1.5 text-sm text-fg placeholder:text-faint focus:border-action/60 focus:outline-none";

function EditEntityCard({
  entity,
  onSaved,
  onCancel,
}: {
  entity: M3Entity;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { tenant } = useTenant();
  const [displayName, setDisplayName] = useState(entity.display_name ?? "");
  const [identifiersText, setIdentifiersText] = useState(
    Object.entries(entity.identifiers)
      .map(([key, value]) => `${key}: ${value}`)
      .join("\n"),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedName = displayName.trim();
    if (!trimmedName) {
      setError("A display name is required.");
      return;
    }
    const identifiers: Record<string, string> = {};
    for (const line of identifiersText.split("\n")) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;
      const separator = trimmedLine.indexOf(":");
      const key = separator > 0 ? trimmedLine.slice(0, separator).trim() : "";
      const value = separator > 0 ? trimmedLine.slice(separator + 1).trim() : "";
      if (!key || !value) {
        setError(`Identifier line "${trimmedLine}" must be "key: value".`);
        return;
      }
      identifiers[key] = value;
    }
    setSaving(true);
    setError(null);
    try {
      await m3.updateEntity(
        entity.entity_id,
        { display_name: trimmedName, identifiers },
        tenant,
      );
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="mb-4">
      <CardHeader
        title="Edit entity"
        description="Saving replaces the identifiers wholesale — the evidence store normalizes them (lowercased keys, canonical domains and handles)."
      />
      <form onSubmit={submit} className="space-y-4 px-4 py-4 sm:px-5" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="edit-entity-name" className="block text-[11px] font-medium text-faint">
              Display name <span className="text-risk-medium">*</span>
            </label>
            <input
              id="edit-entity-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              className={inputClass}
              aria-required="true"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="edit-entity-identifiers" className="block text-[11px] font-medium text-faint">
              Identifiers
            </label>
            <textarea
              id="edit-entity-identifiers"
              value={identifiersText}
              onChange={(event) => setIdentifiersText(event.target.value)}
              rows={3}
              spellCheck={false}
              placeholder={"domain: support-acme.example\nhandle: @acme_help"}
              className={cx(inputClass, "resize-y font-mono text-xs")}
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
            {saving ? "Saving…" : "Save changes"}
          </Button>
          <Button type="button" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

function AttachEvidenceForm({
  entityId,
  sources,
  onAttached,
}: {
  entityId: string;
  sources: Array<{ source_id: string; name: string; kind: string }>;
  onAttached: () => void;
}) {
  const { tenant } = useTenant();
  const [sourceId, setSourceId] = useState(sources[0]?.source_id ?? "");
  const [evidenceType, setEvidenceType] = useState<M3EvidenceType>("TEXT_CONTENT");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [imageHash, setImageHash] = useState("");
  const [newSourceName, setNewSourceName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    let resolvedSourceId = sourceId;
    if (newSourceName.trim()) {
      try {
        const created = await m3.createSource(
          { name: newSourceName.trim(), kind: "fixture" },
          tenant,
        );
        resolvedSourceId = created.source_id;
      } catch (err) {
        setError(`Could not create source: ${errorMessage(err)}`);
        return;
      }
    }
    if (!resolvedSourceId) {
      setError("Pick a source or name a new one — evidence must carry provenance.");
      return;
    }
    if (!text.trim() && !url.trim() && !imageHash.trim()) {
      setError("Provide at least one of text, URL, or image hash.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await m3.createEvidence(
        entityId,
        {
          source_id: resolvedSourceId,
          evidence_type: evidenceType,
          text: text.trim() || null,
          url: url.trim() || null,
          image_hash: imageHash.trim() || null,
        },
        tenant,
      );
      setText("");
      setUrl("");
      setImageHash("");
      setNewSourceName("");
      onAttached();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4 border-b border-line-soft px-4 py-4 sm:px-5" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="evidence-source" className="block text-[11px] font-medium text-faint">
            Source <span className="text-risk-medium">*</span>
          </label>
          <select
            id="evidence-source"
            value={sourceId}
            onChange={(event) => setSourceId(event.target.value)}
            className={inputClass}
            aria-required="true"
          >
            {sources.length === 0 ? <option value="">— none registered —</option> : null}
            {sources.map((source) => (
              <option key={source.source_id} value={source.source_id}>
                {source.name} ({source.kind})
              </option>
            ))}
          </select>
          <input
            aria-label="Or create a new source by name"
            value={newSourceName}
            onChange={(event) => setNewSourceName(event.target.value)}
            placeholder="…or create a new source by name"
            className={cx(inputClass, "text-xs")}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="evidence-type" className="block text-[11px] font-medium text-faint">
            Type <span className="text-risk-medium">*</span>
          </label>
          <select
            id="evidence-type"
            value={evidenceType}
            onChange={(event) => setEvidenceType(event.target.value as M3EvidenceType)}
            className={inputClass}
          >
            {EVIDENCE_TYPES.map((type) => (
              <option key={type} value={type}>
                {EVIDENCE_TYPE_LABEL[type]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <label htmlFor="evidence-text" className="block text-[11px] font-medium text-faint">
            Text
          </label>
          <textarea
            id="evidence-text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={2}
            placeholder="Observed content — e.g. the page or bio text captured for this entity"
            className={cx(inputClass, "resize-y")}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="evidence-url" className="block text-[11px] font-medium text-faint">
            URL
          </label>
          <input
            id="evidence-url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://…"
            spellCheck={false}
            className={inputClass}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="evidence-hash" className="block text-[11px] font-medium text-faint">
            Image hash
          </label>
          <input
            id="evidence-hash"
            value={imageHash}
            onChange={(event) => setImageHash(event.target.value)}
            placeholder="hex digest of a captured visual asset"
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
          {saving ? "Attaching…" : "Attach evidence"}
        </Button>
        <span className="text-[11px] text-faint">
          Every item records its source and collection time — provenance is preserved end-to-end.
        </span>
      </div>
    </form>
  );
}
