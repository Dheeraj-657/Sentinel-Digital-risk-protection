import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getIntelMode, getProviders } from "@/lib/engine/providers/registry";
import { groqModel, isGroqConfigured } from "@/lib/ai/groq";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Reports configuration only — never the API key itself. */
export async function GET() {
  let database = "ok";
  try {
    await prisma.scan.count();
  } catch {
    database = "unavailable — run `npm run setup`";
  }
  const mode = getIntelMode();
  return NextResponse.json({
    status: database === "ok" ? "ok" : "degraded",
    database,
    intelMode: mode,
    ai: { provider: "groq", configured: isGroqConfigured(), model: groqModel() },
    providers: getProviders(mode).map((p) => ({ id: p.id, name: p.name, kind: p.kind, origin: p.origin })),
  });
}
