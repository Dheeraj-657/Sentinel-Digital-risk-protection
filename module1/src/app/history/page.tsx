import { Suspense } from "react";
import { HistoryTable } from "@/components/history-table";

export const metadata = { title: "Scan history — Sentinel" };

export default function HistoryPage() {
  return (
    <div className="mx-auto max-w-[1280px]">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Scan history</h1>
        <p className="mt-2 text-muted">Every analysis is stored. Open a report to see its evidence and how its risk changed across re-scans.</p>
      </header>
      <Suspense>
        <HistoryTable />
      </Suspense>
    </div>
  );
}
