import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useApi, errorMessage } from "../lib/hooks";
import { m1, m2 } from "../lib/api";
import { useTenant } from "../lib/tenant";
import { brandUuidFromCuid } from "../lib/brand-bridge";
import { M1_ENTITY_TYPE_LABEL, formatDateTime } from "../lib/format";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Chip,
  EmptyState,
  ErrorState,
  KeyValue,
  M1RiskLevelBadge,
  PageHeader,
  StatCard,
  TableSkeleton,
} from "../components/ui";
import { BrandFormCard } from "../components/brand-form";
import { ThreatTable } from "../components/threat-table";

export function BrandDetail() {
  const { brandId = "" } = useParams();
  const navigate = useNavigate();
  const { tenant } = useTenant();
  const brand = useApi(() => m1.getBrand(brandId), [brandId]);
  const derivedUuid = brandUuidFromCuid(brandId);
  const threats = useApi(() => m2.listThreats({ limit: 200 }, tenant), [tenant]);
  const scans = useApi(() => m1.listScans({ brand: brandId, limit: 20 }), [brandId]);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (brand.loading) {
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

  if (brand.error) {
    return (
      <Card>
        <ErrorState error={brand.error} onRetry={brand.reload} context="brand" />
      </Card>
    );
  }

  if (!brand.data) {
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

  const data = brand.data;
  const brandThreats = threats.data
    ? threats.data.items.filter((threat) => threat.brand_id === derivedUuid)
    : [];
  const openCount = brandThreats.filter((threat) => threat.status === "OPEN").length;

  const remove = async () => {
    setDeleting(true);
    try {
      await m1.deleteBrand(brandId);
      navigate("/brands");
    } catch (err) {
      setActionError(errorMessage(err));
      setDeleting(false);
      setConfirmingDelete(false);
    }
  };

  return (
    <>
      <PageHeader
        title={data.name}
        description="Brand identity and monitored-asset DNA. The risk engine scores discovered entities against this definition via uuid5-derived brand identity."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" onClick={() => setEditOpen((open) => !open)}>
              {editOpen ? "Close editor" : "Edit brand"}
            </Button>
            {confirmingDelete ? (
              <>
                <Button variant="danger" onClick={remove} disabled={deleting}>
                  {deleting ? "Deleting…" : "Confirm delete"}
                </Button>
                <Button variant="ghost" onClick={() => setConfirmingDelete(false)} disabled={deleting}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
                Delete brand
              </Button>
            )}
            <Link to={`/analysis/new?brand=${encodeURIComponent(data.id)}`}>
              <Button variant="default">Run analysis</Button>
            </Link>
          </div>
        }
      />

      {actionError ? (
        <p role="alert" className="mb-4 rounded border border-risk-critical/40 bg-risk-critical/10 px-4 py-3 text-xs text-risk-critical">
          {actionError}
        </p>
      ) : null}

      {editOpen ? (
        <div className="mb-4">
          <BrandFormCard
            initial={data}
            onSaved={() => {
              setEditOpen(false);
              brand.reload();
              scans.reload();
            }}
            onCancel={() => setEditOpen(false)}
          />
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Threats" value={brandThreats.length} hint="across all entities" />
        <StatCard label="Open" value={openCount} tone={openCount > 0 ? "medium" : "neutral"} />
        <StatCard label="Scans in Sentinel" value={data.scanCount} hint="Module 1 scan counter" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Brand DNA" description="The authentic signals the risk engine compares against." />
          <dl className="grid grid-cols-2 gap-4 px-4 py-4 sm:px-5">
            <KeyValue label="Official domains">
              <TokenList items={data.officialDomains} empty="None" />
            </KeyValue>
            <KeyValue label="Official handles">
              <TokenList items={data.officialHandles} empty="None" />
            </KeyValue>
            <KeyValue label="App developers">
              <TokenList items={data.appDevelopers} empty="None" />
            </KeyValue>
            <KeyValue label="Package prefixes">
              <TokenList items={data.packagePrefixes} empty="None" />
            </KeyValue>
            <KeyValue label="Keywords">
              <TokenList items={data.keywords} empty="None" />
            </KeyValue>
            <KeyValue label="Sentinel ID" mono>
              {data.id}
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
                  <code className="font-mono">uuid5(SENTINEL_BRAND_NAMESPACE, &quot;{data.id}&quot;)</code>
                </p>
                <p>
                  Module 2 references brands by a UUID derived from the Sentinel cuid using the shared
                  namespace <code className="font-mono">uuid5(NAMESPACE_DNS, &quot;trustgraph.module1.sentinel&quot;)</code>.
                  Threat rows carry that UUID, which the console maps back to this brand.
                </p>
              </dd>
            </div>
            {data.isDemo ? (
              <p className="text-xs text-muted">
                <Badge tone="evidence">demo brand</Badge>{" "}
                <span className="ml-1">Seeded by Sentinel in demo mode — read-only.</span>
              </p>
            ) : null}
          </dl>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader
          title="Scans against this brand"
          description={
            scans.data
              ? `${scans.data.total} scan${scans.data.total === 1 ? "" : "s"} scored against this brand's DNA`
              : "Sentinel engine scans that ran with this brand selected."
          }
          actions={
            <Link to={`/scan/new`} className="text-xs font-medium text-action hover:text-fg">
              New scan →
            </Link>
          }
        />
        {scans.loading ? (
          <TableSkeleton rows={3} />
        ) : scans.error ? (
          <ErrorState error={scans.error} onRetry={scans.reload} context="scans" />
        ) : !scans.data || scans.data.items.length === 0 ? (
          <EmptyState
            title="No scans against this brand"
            description="Run the Sentinel engine with this brand selected to score a target against its DNA."
            action={
              <Link to="/scan/new">
                <Button variant="primary">New scan</Button>
              </Link>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line-soft text-[11px] uppercase tracking-widest text-faint">
                  <th scope="col" className="px-4 py-2.5 font-medium sm:px-5">
                    Target
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Type
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Risk
                  </th>
                  <th scope="col" className="hidden px-4 py-2.5 font-medium sm:table-cell">
                    Confidence
                  </th>
                  <th scope="col" className="hidden px-4 py-2.5 font-medium sm:table-cell">
                    Signals
                  </th>
                  <th scope="col" className="hidden px-4 py-2.5 font-medium lg:table-cell">
                    When
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {scans.data.items.map((scan) => (
                  <tr key={scan.id} className="transition hover:bg-raised/50">
                    <td className="px-4 py-3 sm:px-5">
                      <Link to={`/scans/${scan.id}`} className="block text-fg hover:text-action">
                        <span className="font-medium">{scan.displayName}</span>
                        <span className="block font-mono text-[11px] text-faint">{scan.target}</span>
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">
                      {M1_ENTITY_TYPE_LABEL[scan.entityType] ?? scan.entityType}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="flex items-center gap-2">
                        <M1RiskLevelBadge level={scan.riskLevel} />
                        <span className="font-mono text-xs text-fg">{scan.riskScore}</span>
                      </span>
                    </td>
                    <td className="hidden px-4 py-3 font-mono text-xs text-muted sm:table-cell">
                      {scan.confidenceScore}
                    </td>
                    <td className="hidden px-4 py-3 font-mono text-xs text-muted sm:table-cell">
                      {scan.signalCount}
                    </td>
                    <td className="hidden whitespace-nowrap px-4 py-3 text-xs text-muted lg:table-cell">
                      {formatDateTime(scan.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

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
              <Link to={`/analysis/new?brand=${encodeURIComponent(data.id)}`}>
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
