import { listBrands } from "@/lib/scans";
import { BrandManager } from "@/components/brand-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Protected brands — Sentinel" };

export default async function BrandsPage() {
  const brands = await listBrands();
  return (
    <div className="mx-auto max-w-[1280px]">
      <header className="mb-6 max-w-3xl">
        <h1 className="text-3xl font-bold tracking-tight">Protected brands</h1>
        <p className="mt-2 text-muted">
          The brands and people you protect, with their official domains, accounts and app publishers. Anything that imitates them without
          being on this list is treated as a possible impersonation.
        </p>
      </header>
      <BrandManager brands={brands} />
    </div>
  );
}
