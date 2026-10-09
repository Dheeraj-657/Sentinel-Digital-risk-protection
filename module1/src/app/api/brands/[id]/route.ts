import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { apiError } from "@/lib/api";

export const runtime = "nodejs";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await prisma.brand.findUnique({ where: { id } });
  if (!b) return apiError(404, "NOT_FOUND", "Brand not found.");
  if (b.isDemo) return apiError(400, "DEMO_BRAND", "Demo brands can't be deleted — they back the sample entities.");
  await prisma.brand.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
