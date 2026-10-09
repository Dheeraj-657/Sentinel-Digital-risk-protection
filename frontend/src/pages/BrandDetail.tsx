import { Link, useParams } from "react-router-dom";
import { useApi } from "../lib/hooks";
import { m1, m2 } from "../lib/api";
import { useTenant } from "../lib/tenant";
import { brandUuidFromCuid } from "../lib/brand-bridge";
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
  TableSkeleton,
} from "../components/ui";
import { ThreatTable } from "../components/threat-table";

/** Brand detail is rendered from the Sentinel list — Module 1 exposes
 * no GET-by-id, so the row is located client-side. */
export function BrandDetail() {
  const { brandId = "" } = useParams();
  const brands = useApi(() => m1.listBrands(), []);
  const { tenant } = useTenant();
  const derivedUuid = brands.data ? brandUuidFromCuid(brandId) : "";
  const threats = useApi(
    () => m2.listThreats({ limit: 200 }, tenant),
    [tenant, brands.loading],
  );
  const brand = brands.data?.items.find((item) => item.id === brandId);

  if (brands.loading) {
    return (
      <>
        <PageHeader title="Brand" />
        <Card className="px-4 py-3.5">
          <div className="animate-pulse space-y-3">
            <div className="h-6 w-48 rounded bg-raised" />
            <div className="h-4 w-72 rounded bg-raised" />
          </div>
        </Card>
      </>
    );
  }

  if (brands.error) {
    return (
      <Card>
        <ErrorState error={brands.error} onRetry={brands.reload} context="brand" />
      </Card>
    );
  }

  if (!brand) {
    return (
      <Card>
        <EmptyState
          title="Brand not found"
          description={
            <span>
              This brand is not registered in Sentinel DRP.{" "}
              <Link to="/brands" className="text-action hover:underline">
                Back to brands
              </Link>
            </span>
          }
        />
      </Card>
    );
  }

  const brandThreats = threats.data
    ? threats.data.items.filter((threat) => threat.brand_id === derivedUuid)
    : [];
  const openCount = brandThreats.filter((threat) => threat.status === "OPEN").length;

  return (
    <>
      <PageHeader
        title={brand.name}
        description="Brand identity and monitored-asset DNA. The risk engine scores discovered entities against this definition via uuid5-derived brand identity."
        actions={
          <Link to={`/analysis/new?brand=${encodeURIComponent(brand.id)}`}>
            <Button variant="primary">Run analysis</Button>
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Threats" value={brandThreats.length} hint="across all entities" />
        <StatCard label="Open" value={openCount} tone={openCount > 0 ? "medium" : "neutral"} />
        <StatCard label="Scans in Sentinel" value={brand.scanCount} hint="Module 1 scan counter" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Brand DNA" description="The authentic signals the risk engine compares against." />
          <dl className="grid grid-cols-2 gap-4 px-4 py-4 sm:px-5">
            <KeyValue label="Official domains">
              <TokenList items={brand.officialDomains} empty="None" />
            </KeyValue>
            <KeyValue label="Official handles">
              <TokenList items={brand.officialHandles} empty="None" />
            </KeyValue>
            <KeyValue label="App developers">
              <TokenList items={brand.appDevelopers} empty="None" />
            </KeyValue>
            <KeyValue label="Package prefixes">
              <TokenList items={brand.packagePrefixes} empty="None" />
            </KeyValue>
            <KeyValue label="Keywords">
              <TokenList items={brand.keywords} empty="None" />
            </KeyValue>
            <KeyValue label="Sentinel ID" mono>
              {brand.id}
            </KeyValue>
          </dl>
        </Card>

        <Card>
          <CardHeader
            title="Module 2 mapping"
            description="How this brand is referenced by the risk engine and threat records."
          />
          <dl className="space-y-4 px-4 py-4 sm:px-5">
            <KeyValue label="Derived brand UUID" mono>
              {derivedUuid}
            </KeyValue>
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-widest text-faint">Derivation</dt>
              <dd className="mt-1 space-y-1 text-xs leading-relaxed text-muted">
                <p>
                  <code className="font-mono">uuid5(SENTINEL_BRAND_NAMESPACE, &quot;{brand.id}&quot;)</code>
                </p>
                <p>
                  Module 2 references brands by a UUID derived from the Sentinel cuid using the shared
                  namespace <code className="font-mono">uuid5(NAMESPACE_DNS, &quot;trustgraph.module1.sentinel&quot;)</code>.
                  Threat rows carry that UUID, which the console maps back to this brand.
                </p>
              </dd>
            </div>
            {brand.isDemo ? (
              <p className="text-xs text-muted">
                <Badge tone="evidence">demo brand</Badge>{" "}
                <span className="ml-1">Seeded by Sentinel in demo mode.</span>
              </p>
            ) : null}
          </dl>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader
          title="Threats against this brand"
          description="Threat records from the risk engine whose brand UUID matches this brand."
        />
        {threats.loading ? (
          <TableSkeleton rows={3} />
        ) : threats.error ? (
          <ErrorState error={threats.error} onRetry={threats.reload} context="threats" />
        ) : brandThreats.length === 0 ? (
          <EmptyState
            title="No threats recorded"
            description="Run an analysis against a discovered entity to score it for this brand."
            action={
              <Link to={`/analysis/new?brand=${encodeURIComponent(brand.id)}`}>
                <Button variant="primary">Run analysis</Button>
              </Link>
            }
          />
        ) : (
          <ThreatTable threats={brandThreats} showBrand={false} />
        )}
      </Card>
    </>
  );
}

function TokenList({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <span className="text-xs text-faint">{empty}</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {items.map((item) => (
        <Chip key={item}>{item}</Chip>
      ))}
    </span>
  );
}
