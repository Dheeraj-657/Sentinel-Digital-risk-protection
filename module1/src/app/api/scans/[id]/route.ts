import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getReport, targetHistory } from "@/lib/scans";
import { apiError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/scans/:id — full stored report + risk history for the same target. */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const report = await getReport(id);
  if (!report) return apiError(404, "NOT_FOUND", "Scan not found.");
  const history = await targetHistory(report.entity.target);
  return NextResponse.json({ report, history });
}

/** DELETE /api/scans/:id */
export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const res = await prisma.scan.deleteMany({ where: { id } });
  if (!res.count) return apiError(404, "NOT_FOUND", "Scan not found.");
  return new NextResponse(null, { status: 204 });
}
