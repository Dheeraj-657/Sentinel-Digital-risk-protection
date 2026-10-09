import { useState } from "react";
import { Link } from "react-router-dom";
import { useApi, errorMessage } from "../lib/hooks";
import { m1 } from "../lib/api";
import { Badge, Card, CardHeader, EmptyState, ErrorState, PageHeader, TableSkeleton } from "../components/ui";
import { BrandFormCard } from "../components/brand-form";
import { brandUuidFromCuid } from "../lib/brand-bridge";
import type { M1Brand } from "../lib/types";

export function Brands() {
  const brands = useApi(() => m1.listBrands(), []);
  const health = useApi(() => m1.health(), []);
  const [formOpen, setFormOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const demoCount = brands.data?.items.filter((brand) => brand.isDemo).length;

  return (
    <>
      <PageHeader
        title="Brands"
        description="Brand identities monitored for impersonation. Brands and their DNA (official domains, handles, app developers) are stored in Sentinel DRP (Module 1) — the source of truth — and managed from this console."
        actions={
          <button
            type="button"
            onClick={() => setFormOpen((open) => !open)}
            className="rounded border border-action/60 bg-action/15 px-3 py-1.5 text-xs font-semibold text-action transition hover:bg-action/25"
          >
            {formOpen ? "Close" : "Create brand"}
          </button>
        }
      />

      {formOpen ? (
        <div className="mb-4">
          <BrandFormCard
            onSaved={() => {
              setFormOpen(false);
              brands.reload();
            }}
            onCancel={() => setFormOpen(false)}
          />
        </div>
      ) : null}

      <Card>
        <CardHeader
          title="Monitored brands"
          description={
            health.data
              ? `Brand service intel mode: ${health.data.intelMode}${demoCount !== undefined ? ` — ${demoCount} demo brand${demoCount === 1 ? "" : "s"} included` : ""}`
              : undefined
          }
        />
        {brands.loading ? (
          <TableSkeleton rows={4} cols={5} />
        ) : brands.error ? (
          <ErrorState error={brands.error} onRetry={brands.reload} context="brands" />
        ) : !brands.data || brands.data.items.length === 0 ? (
          <EmptyState
            title="No brands registered"
            description="Register a brand to define what to protect — official domains, handles, and keywords the risk engine compares against."
            action={
              <button
                type="button"
                onClick={() => setFormOpen(true)}
                className="rounded border border-action/60 bg-action/15 px-3 py-1.5 text-xs font-semibold text-action transition hover:bg-action/25"
              >
                Create brand
              </button>
            }
          />
        ) : (
          <BrandRows
            items={brands.data.items}
            onDeleted={brands.reload}
            onError={setActionError}
          />
        )}
        {actionError ? (
          <p role="alert" className="border-t border-line-soft px-4 py-3 text-xs text-risk-medium sm:px-5">
            {actionError}
          </p>
        ) : null}
      </Card>
    </>
  );
}

function BrandRows({
  items,
  onDeleted,
  onError,
}: {
  items: M1Brand[];
  onDeleted: () => void;
  onError: (message: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line-soft text-[11px] uppercase tracking-widest text-faint">
            <th scope="col" className="px-4 py-2.5 font-medium sm:px-5">
              Brand
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              DNA coverage
            </th>
            <th scope="col" className="hidden px-4 py-2.5 font-medium sm:table-cell">
              Derived risk-engine ID
            </th>
            <th scope="col" className="hidden px-4 py-2.5 font-medium lg:table-cell">
              Scans
            </th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium sm:px-5">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line-soft">
          {items.map((brand) => (
            <tr key={brand.id} className="group transition hover:bg-raised/50">
              <td className="px-4 py-3 sm:px-5">
                <Link to={`/brands/${brand.id}`} className="flex items-center gap-2 text-fg hover:text-action">
                  <span className="font-medium">{brand.name}</span>
                  {brand.isDemo ? <Badge tone="evidence">demo</Badge> : null}
                </Link>
              </td>
              <td className="px-4 py-3 text-xs text-muted">
                {countDna(brand)} signals
              </td>
              <td className="hidden px-4 py-3 font-mono text-xs text-faint sm:table-cell">
                {brandUuidFromCuid(brand.id).slice(0, 13)}…
              </td>
              <td className="hidden px-4 py-3 text-xs text-muted lg:table-cell">
                {brand.scanCount}
              </td>
              <td className="px-4 py-3 sm:px-5">
                <BrandRowActions brand={brand} onDeleted={onDeleted} onError={onError} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BrandRowActions({
  brand,
  onDeleted,
  onError,
}: {
  brand: M1Brand;
  onDeleted: () => void;
  onError: (message: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    setBusy(true);
    try {
      await m1.deleteBrand(brand.id);
      onDeleted();
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <div className="flex items-center justify-end gap-3">
      <Link to={`/brands/${brand.id}`} className="text-xs font-medium text-action hover:underline">
        Edit
      </Link>
      {confirming ? (
        <>
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="text-xs font-semibold text-risk-critical hover:underline disabled:opacity-50"
          >
            {busy ? "Deleting…" : "Confirm delete"}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={busy}
            className="text-xs text-muted hover:text-fg"
          >
            Cancel
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="text-xs text-risk-medium hover:text-risk-critical hover:underline"
        >
          Delete
        </button>
      )}
    </div>
  );
}

function countDna(brand: M1Brand): number {
  return (
    brand.officialDomains.length +
    brand.officialHandles.length +
    brand.appDevelopers.length +
    brand.packagePrefixes.length +
    brand.keywords.length
  );
}
