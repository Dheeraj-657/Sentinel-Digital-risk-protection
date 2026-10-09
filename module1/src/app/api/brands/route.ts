import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { brandInputSchema } from "@/lib/engine/entity";
import { listBrands } from "@/lib/scans";
import { normalizeBrandInput } from "@/lib/brand-input";
import { apiError, readJson, zodToApiError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ items: await listBrands() });
}

export async function POST(req: Request) {
  const parsed = brandInputSchema.safeParse(await readJson(req));
  if (!parsed.success) return zodToApiError(parsed.error);
  const b = parsed.data;
  const exists = await prisma.brand.findUnique({ where: { name: b.name } });
  if (exists) return apiError(409, "BRAND_EXISTS", `A protected brand named "${b.name}" already exists.`, { field: "name" });
  const created = await prisma.brand.create({ data: normalizeBrandInput(b) });
  return NextResponse.json({ id: created.id }, { status: 201 });
}
