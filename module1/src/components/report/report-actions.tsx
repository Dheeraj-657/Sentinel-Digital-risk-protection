"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Download, Trash2 } from "lucide-react";
import type { AnalysisReport } from "@/lib/engine/types";
import { Button } from "@/components/ui/primitives";

export function ReportActions({ report }: { report: AnalysisReport }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"rescan" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function rescan() {
    setBusy("rescan");
    setError(null);
    try {
      const res = await fetch("/api/scans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entityType: report.entity.type,
          input: report.entity.input,
          claimedDeveloper: report.entity.claimedDeveloper,
          ...(report.brand?.id ? { brandId: report.brand.id } : report.brand ? { brand: report.brand } : {}),
        }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error?.message ?? `Re-scan failed (${res.status})`);
      router.push(`/scans/${j.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Re-scan failed");
      setBusy(null);
    }
  }

  function exportJson() {
    // The structured analysis response, as returned by the API.
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `risk-report-${report.entity.target.replace(/[^a-z0-9.-]+/gi, "_")}-${report.id}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function remove() {
    if (!confirm("Delete this scan from history? This can't be undone.")) return;
    setBusy("delete");
    const res = await fetch(`/api/scans/${report.id}`, { method: "DELETE" });
    if (res.ok || res.status === 404) router.push("/history");
    else {
      setError("Couldn't delete this scan.");
      setBusy(null);
    }
  }

  return (
    <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
      <div className="flex flex-wrap gap-2 sm:flex-nowrap">
        <Button variant="ghost" onClick={rescan} disabled={busy !== null}>
          <RefreshCw className={`size-4 ${busy === "rescan" ? "animate-spin" : ""}`} aria-hidden />
          {busy === "rescan" ? "Re-scanning…" : "Re-scan"}
        </Button>
        <Button variant="ghost" onClick={exportJson} disabled={busy !== null}>
          <Download className="size-4" aria-hidden />
          Export JSON
        </Button>
        <Button variant="ghost" onClick={remove} disabled={busy !== null} aria-label="Delete scan">
          <Trash2 className="size-4" aria-hidden />
        </Button>
      </div>
      {error && <p role="alert" className="text-sm text-risk-critical">{error}</p>}
    </div>
  );
}
