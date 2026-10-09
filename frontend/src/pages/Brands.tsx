import { Link } from "react-router-dom";
import { useApi } from "../lib/hooks";
import { m1 } from "../lib/api";
import { Badge, Card, CardHeader, EmptyState, ErrorState, PageHeader, TableSkeleton } from "../components/ui";
import { brandUuidFromCuid } from "../lib/brand-bridge";
import type { M1Brand } from "../lib/types";

/** Module 1's brand list — the console is read-only here; brands are
 * managed in Sentinel DRP. */
export function Brands() {
  const brands = useApi(() => m1.listBrands(), []);
  const health = useApi(() => m1.health(), []);

  const demoCount = brands.data?.items.filter((brand) => brand.isDemo).length;

  return (
    <>
      <PageHeader
        title="Brands"
        description="Brand identities monitored for impersonation. Read-only in this console — brands and their DNA (official domains, handles, app developers) are managed in Sentinel DRP (Module 1), which is the source of truth."
      />
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
            description="Register a brand in Sentinel DRP to define what to protect — official domains, handles, and keywords the risk engine compares against."
          />
        ) : (
          <BrandRows items={brands.data.items} />
        )}
      </Card>
    </>
  );
}

function BrandRows({ items }: { items: M1Brand[] }) {
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
            </tr>
          ))}
        </tbody>
      </table>
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
