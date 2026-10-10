import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { apiError, readJson, zodToApiError } from "@/lib/api";
import { brandInputSchema } from "@/lib/engine/entity";
import { getBrandDetail } from "@/lib/scans";
import { normalizeBrandInput } from "@/lib/brand-input";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const brand = await getBrandDetail(id);
  if (!brand) return apiError(404, "NOT_FOUND", "Brand not found.");
  return NextResponse.json(brand);
}

/**
 * Full-replace edit of the editable fields (name + the five lists) — the
 * console's edit form always submits the complete shape. Demo brands are
 * read-only: they back the sample entities.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const existing = await prisma.brand.findUnique({ where: { id } });
  if (!existing) return apiError(404, "NOT_FOUND", "Brand not found.");
  if (existing.isDemo) return apiError(400, "DEMO_BRAND", "Demo brands can't be edited — they back the sample entities.");
  const parsed = brandInputSchema.safeParse(await readJson(req));
  if (!parsed.success) return zodToApiError(parsed.error);
  const clash = await prisma.brand.findUnique({ where: { name: parsed.data.name } });
  if (clash && clash.id !== id) {
    return apiError(409, "BRAND_EXISTS", `A protected brand named "${parsed.data.name}" already exists.`, { field: "name" });
  }
  await prisma.brand.update({ where: { id }, data: normalizeBrandInput(parsed.data) });
  return NextResponse.json(await getBrandDetail(id));
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await prisma.brand.findUnique({ where: { id } });
  if (!b) return apiError(404, "NOT_FOUND", "Brand not found.");
  if (b.isDemo) return apiError(400, "DEMO_BRAND", "Demo brands can't be deleted — they back the sample entities.");
  await prisma.brand.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
