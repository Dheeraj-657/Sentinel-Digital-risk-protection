import { Suspense } from "react";
import { listBrands } from "@/lib/scans";
import { ScannerForm } from "@/components/scanner/scanner-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "New analysis — Sentinel" };

export default async function ScanPage() {
  const brands = await listBrands();
  return (
    <div className="mx-auto max-w-[1280px]">
      <header className="mb-7 max-w-3xl">
        <h1 className="text-3xl font-bold tracking-tight">New analysis</h1>
        <p className="mt-2 text-muted">
          Submit a profile, website, domain or app. Sentinel gathers intelligence, scores it with fixed rules, then has the AI explain the
          evidence it found.
        </p>
      </header>
      <Suspense>
        <ScannerForm
          brands={brands.map((b) => ({
            id: b.id,
            name: b.name,
            officialDomains: b.officialDomains,
            officialHandles: b.officialHandles,
            appDevelopers: b.appDevelopers,
            packagePrefixes: b.packagePrefixes,
            isDemo: b.isDemo,
          }))}
        />
      </Suspense>
    </div>
  );
}
