import { useState } from "react";
import { useApi, errorMessage } from "../lib/hooks";
import { m3 } from "../lib/api";
import { useTenant } from "../lib/tenant";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Chip,
  EmptyState,
  ErrorState,
  PageHeader,
  TableSkeleton,
} from "../components/ui";
import { formatDateTime } from "../lib/format";

const PAGE_SIZE = 25;

const inputClass =
  "w-full rounded border border-line bg-ink px-2.5 py-1.5 text-sm text-fg placeholder:text-faint focus:border-action/60 focus:outline-none";

export function Sources() {
  const { tenant } = useTenant();
  const [offset, setOffset] = useState(0);

  const sources = useApi(
    () => m3.listSources({ limit: PAGE_SIZE, offset }, tenant),
    [tenant, offset],
  );

  const total = sources.data?.total ?? 0;
  const nextOffset = offset + PAGE_SIZE;
  const hasPrev = offset > 0;
  const hasNext = nextOffset < total;

  return (
    <>
      <PageHeader
        title="Sources"
        description="Evidence collection sources registered in the store. Every evidence item cites one of these — create real sources instead of relying on shared fixtures."
      />

      <Card className="mb-4">
        <CardHeader
          title="Register a source"
          description="A source names where evidence came from (a feed, an analyst, a crawler). Kind is free-form so any pipeline can integrate."
        />
        <CreateSourceCard
          onCreated={() => {
            setOffset(0);
            sources.reload();
          }}
        />
      </Card>

      <Card>
        <CardHeader
          title="Source register"
          description={
            sources.data
              ? `${total} source${total === 1 ? "" : "s"} in tenant — showing ${sources.data.items.length}`
              : undefined
          }
        />
        {sources.loading ? (
          <TableSkeleton rows={4} cols={3} />
        ) : sources.error ? (
          <ErrorState error={sources.error} onRetry={sources.reload} context="sources" />
        ) : !sources.data || sources.data.items.length === 0 ? (
          <EmptyState
            title="No sources yet"
            description="Register the first source above, then attach evidence citing it from an entity page."
          />
        ) : (
          <>
            <ul className="divide-y divide-line-soft">
              {sources.data.items.map((source) => (
                <li
                  key={source.source_id}
                  className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm sm:px-5"
                >
                  <span className="min-w-0 flex-1 truncate text-fg">{source.name}</span>
                  <Chip>{source.kind}</Chip>
                  <span className="text-xs text-faint">{formatDateTime(source.created_at)}</span>
                </li>
              ))}
            </ul>
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

function CreateSourceCard({ onCreated }: { onCreated: () => void }) {
  const { tenant } = useTenant();
  const [name, setName] = useState("");
  const [kind, setKind] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError("A source name is required.");
      return;
    }
    if (!kind.trim()) {
      setError("A source kind is required (e.g. feed, analyst, crawler).");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await m3.createSource({ name: name.trim(), kind: kind.trim() }, tenant);
      setName("");
      setKind("");
      onCreated();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-4 px-4 py-4 sm:grid-cols-2 sm:px-5" noValidate>
      <div className="space-y-1.5">
        <label htmlFor="source-name" className="block text-[11px] font-medium text-faint">
          Name <span className="text-risk-medium">*</span>
        </label>
        <input
          id="source-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Acme Brand Watch feed"
          className={inputClass}
          aria-required="true"
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="source-kind" className="block text-[11px] font-medium text-faint">
          Kind <span className="text-risk-medium">*</span>
        </label>
        <input
          id="source-kind"
          value={kind}
          onChange={(event) => setKind(event.target.value)}
          placeholder="feed · analyst · crawler · manual"
          spellCheck={false}
          className={inputClass}
          aria-required="true"
        />
      </div>
      {error ? (
        <p role="alert" className="text-xs text-risk-medium sm:col-span-2">
          {error}
        </p>
      ) : null}
      <div className="flex items-center gap-2 sm:col-span-2">
        <Button variant="primary" type="submit" disabled={saving}>
          {saving ? "Saving…" : "Register source"}
        </Button>
        <span className="text-[11px] text-faint">
          Kind is free-form — use whatever your pipeline calls it. <Badge tone="evidence">fixture</Badge>{" "}
          sources come from the demo seed.
        </span>
      </div>
    </form>
  );
}
