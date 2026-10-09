import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { brandInputSchema } from "@/lib/engine/entity";
import { listBrands } from "@/lib/scans";
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
  const created = await prisma.brand.create({
    data: {
      name: b.name,
      officialDomains: b.officialDomains.map((d) => d.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "")),
      officialHandles: b.officialHandles.map((h) => h.toLowerCase().replace(/^@/, "")),
      appDevelopers: b.appDevelopers,
      packagePrefixes: b.packagePrefixes.map((p) => p.toLowerCase()),
      keywords: b.keywords.map((k) => k.toLowerCase()),
    },
  });
  return NextResponse.json({ id: created.id }, { status: 201 });
}
