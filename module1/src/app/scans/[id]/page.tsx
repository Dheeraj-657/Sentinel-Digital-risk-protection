import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getReport, targetHistory } from "@/lib/scans";
import { ReportView } from "@/components/report/report-view";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const r = await getReport(id);
  return { title: r ? `${r.entity.displayName} (${r.riskScore}/100) — Sentinel` : "Scan not found — Sentinel" };
}

export default async function ScanReportPage({ params }: Props) {
  const { id } = await params;
  const report = await getReport(id);
  if (!report) notFound();
  const history = await targetHistory(report.entity.target);
  return <ReportView report={report} history={history} />;
}
