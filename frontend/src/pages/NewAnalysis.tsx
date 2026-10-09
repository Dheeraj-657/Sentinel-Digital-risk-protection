import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useApi, errorMessage } from "../lib/hooks";
import { m1, m3 } from "../lib/api";
import { useTenant } from "../lib/tenant";
import { m2 } from "../lib/api";
import { brandUuidFromCuid } from "../lib/brand-bridge";
import { ENTITY_TYPE_LABEL, EVIDENCE_TYPE_LABEL, formatDateTime } from "../lib/format";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  PageHeader,
} from "../components/ui";
import { useToast } from "../components/toast";

const inputClass =
  "w-full rounded border border-line bg-ink px-2.5 py-1.5 text-sm text-fg focus:border-action/60 focus:outline-none";

export function NewAnalysis() {
  const { tenant } = useTenant();
  const navigate = useNavigate();
  const { push } = useToast();
  const [searchParams] = useSearchParams();

  const brands = useApi(() => m1.listBrands(), []);
  const entities = useApi(() => m3.listEntities({ limit: 200 }, tenant), [tenant]);

  const [brandId, setBrandId] = useState<string>("");
  const [entityId, setEntityId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolvedBrandId = useMemo(() => {
    if (brandId) return brandId;
    const param = searchParams.get("brand");
    if (!param || !brands.data) return "";
    const direct = brands.data.items.find((brand) => brand.id === param);
    if (direct) return direct.id;
    const derived = brands.data.items.find(
      (brand) => brandUuidFromCuid(brand.id) === param.toLowerCase(),
    );
    return derived?.id ?? "";
  }, [brandId, brands.data, searchParams]);

  const resolvedEntityId = entityId || searchParams.get("entity") || "";

  const preview = useApi(
    () =>
      resolvedEntityId
        ? m3.listEvidence(resolvedEntityId, tenant)
        : Promise.resolve([]),
    [tenant, resolvedEntityId],
  );

  const selectedBrand = brands.data?.items.find((brand) => brand.id === resolvedBrandId);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!resolvedBrandId || !resolvedEntityId) return;
    setSubmitting(true);
    setError(null);
    try {
      // M2 references brands by the uuid5 derived from the Sentinel cuid.
      const job = await m2.createAnalysis(
        brandUuidFromCuid(resolvedBrandId),
        resolvedEntityId,
        tenant,
      );
      push("success", `Analysis queued — job ${job.job_id}.`);
      navigate(`/analysis/${job.job_id}`);
    } catch (err) {
      setError(errorMessage(err));
      setSubmitting(false);
    }
  };

  const canSubmit =
    resolvedBrandId !== "" &&
    resolvedEntityId !== "" &&
    !submitting &&
    !preview.loading &&
    (preview.data?.length ?? 0) > 0;

  return (
    <>
      <PageHeader
        title="Run analysis"
        description="Score a discovered entity against a protected brand. The risk engine fetches the entity's evidence, weighs each factor family, and returns a threat record with full provenance."
      />

      {brands.error ? (
        <Card className="mb-4">
          <ErrorState error={brands.error} onRetry={brands.reload} context="brands" />
        </Card>
      ) : null}
      {entities.error ? (
        <Card className="mb-4">
          <ErrorState error={entities.error} onRetry={entities.reload} context="entities" />
        </Card>
      ) : null}

      <form onSubmit={submit}>
        <Card>
          <CardHeader
            title="Select inputs"
            description="One brand, one entity, one run. The engine references the brand by its derived UUID."
          />
          <div className="grid gap-5 px-4 py-4 sm:px-5 md:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="analysis-brand" className="block text-[11px] font-medium uppercase tracking-widest text-faint">
                Protected brand <span className="text-risk-medium">*</span>
              </label>
              {brands.loading ? (
                <p className="text-xs text-faint">Loading brands…</p>
              ) : (
                <select
                  id="analysis-brand"
                  value={resolvedBrandId}
                  onChange={(event) => setBrandId(event.target.value)}
                  className={inputClass}
                  aria-required="true"
                  aria-describedby="analysis-brand-hint"
                >
                  <option value="">Select a brand…</option>
                  {(brands.data?.items ?? []).map((brand) => (
                    <option key={brand.id} value={brand.id}>
                      {brand.name}
                      {brand.isDemo ? " (demo)" : ""}
                    </option>
                  ))}
                </select>
              )}
              {selectedBrand ? (
                <p id="analysis-brand-hint" className="text-[11px] leading-relaxed text-faint">
                  DNA: {selectedBrand.officialDomains.length} domain
                  {selectedBrand.officialDomains.length === 1 ? "" : "s"},{" "}
                  {selectedBrand.officialHandles.length} handle
                  {selectedBrand.officialHandles.length === 1 ? "" : "s"},{" "}
                  {selectedBrand.keywords.length} keyword
                  {selectedBrand.keywords.length === 1 ? "" : "s"} · derived UUID{" "}
                  <span className="font-mono">{brandUuidFromCuid(selectedBrand.id).slice(0, 8)}…</span>
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="analysis-entity" className="block text-[11px] font-medium uppercase tracking-widest text-faint">
                Discovered entity <span className="text-risk-medium">*</span>
              </label>
              {entities.loading ? (
                <p className="text-xs text-faint">Loading entities…</p>
              ) : (
                <select
                  id="analysis-entity"
                  value={resolvedEntityId}
                  onChange={(event) => setEntityId(event.target.value)}
                  className={inputClass}
                  aria-required="true"
                >
                  <option value="">Select an entity…</option>
                  {(entities.data?.items ?? []).map((entity) => (
                    <option key={entity.entity_id} value={entity.entity_id}>
                      {entity.display_name ?? entity.entity_id} —{" "}
                      {ENTITY_TYPE_LABEL[entity.entity_type] ?? entity.entity_type}
                    </option>
                  ))}
                </select>
              )}
              <p className="text-[11px] leading-relaxed text-faint">
                No entity yet?{" "}
                <Link to="/entities" className="text-action hover:underline">
                  Register one
                </Link>{" "}
                and attach evidence first.
              </p>
            </div>
          </div>

          {resolvedEntityId ? (
            <div className="border-t border-line-soft">
              <CardHeader
                title="Evidence to be scored"
                description={
                  preview.loading
                    ? "Fetching evidence…"
                    : `The engine will weigh these ${preview.data?.length ?? 0} item${preview.data?.length === 1 ? "" : "s"}.`
                }
              />
              {preview.loading ? (
                <div className="px-4 py-3 text-xs text-faint sm:px-5">Loading…</div>
              ) : preview.error ? (
                <div className="px-4 py-3 sm:px-5">
                  <ErrorState error={preview.error} onRetry={preview.reload} context="evidence" />
                </div>
              ) : (preview.data?.length ?? 0) === 0 ? (
                <EmptyState
                  title="No evidence on this entity"
                  description="The engine needs evidence to score. Attach at least one item on the entity page first."
                  action={
                    <Link to={`/entities/${resolvedEntityId}`}>
                      <Button>Attach evidence</Button>
                    </Link>
                  }
                />
              ) : (
                <ul className="divide-y divide-line-soft">
                  {(preview.data ?? []).map((item) => (
                    <li
                      key={item.evidence_id}
                      className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-xs sm:px-5"
                    >
                      <Badge tone="evidence">
                        {EVIDENCE_TYPE_LABEL[item.evidence_type] ?? item.evidence_type}
                      </Badge>
                      <span className="min-w-0 flex-1 truncate text-muted">
                        {item.text ?? item.url ?? item.image_hash ?? "—"}
                      </span>
                      <span className="text-faint">{formatDateTime(item.collected_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="border-t border-line-soft px-4 py-3 text-xs text-risk-medium sm:px-5">
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-3 border-t border-line-soft px-4 py-4 sm:px-5">
            <Button variant="primary" type="submit" disabled={!canSubmit}>
              {submitting ? "Submitting…" : "Run analysis"}
            </Button>
            {!preview.loading && resolvedEntityId !== "" && (preview.data?.length ?? 0) === 0 ? (
              <span className="text-xs text-risk-medium">
                Disabled — this entity has no evidence to score.
              </span>
            ) : (
              <span className="text-[11px] text-faint">
                Jobs run asynchronously — you'll land on a live status page.
              </span>
            )}
          </div>
        </Card>
      </form>
    </>
  );
}
