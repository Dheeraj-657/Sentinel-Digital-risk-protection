import { NextResponse } from "next/server";
import { z } from "zod";
import { scanRequestSchema, normalizeBrand, EntityValidationError } from "@/lib/engine/entity";
import { analyzeEntity } from "@/lib/engine/pipeline";
import { explainWithGroq } from "@/lib/ai/groq";
import { getBrand, listScans, saveReport } from "@/lib/scans";
import { apiError, readJson, zodToApiError } from "@/lib/api";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { ENTITY_TYPES, RISK_LEVELS } from "@/lib/engine/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/scans — run a full analysis and store it. */
export async function POST(req: Request) {
  const rl = rateLimit(clientKey(req));
  if (!rl.ok) {
    return apiError(429, "RATE_LIMITED", `Too many scans. Try again in ${rl.retryAfterSec}s.`, { retryAfterSec: rl.retryAfterSec });
  }

  const raw = await readJson(req);
  if (raw === null || typeof raw !== "object") return apiError(400, "INVALID_JSON", "Request body must be a JSON object.");
  const parsed = scanRequestSchema.safeParse(raw);
  if (!parsed.success) return zodToApiError(parsed.error);
  const body = parsed.data;

  let brand = null;
  let brandId: string | null = null;
  if (body.brandId) {
    brand = await getBrand(body.brandId);
    if (!brand) return apiError(404, "BRAND_NOT_FOUND", "Selected protected brand no longer exists.", { field: "brandId" });
    brandId = body.brandId;
  } else if (body.brand) {
    brand = normalizeBrand(body.brand);
  }

  try {
    const report = await analyzeEntity({
      entityType: body.entityType,
      input: body.input,
      claimedDeveloper: body.claimedDeveloper,
      brand,
      explain: explainWithGroq,
    });
    const id = await saveReport(report, brandId);
    return NextResponse.json({ ...report, id }, { status: 201 });
  } catch (err) {
    if (err instanceof EntityValidationError) return apiError(400, "INVALID_ENTITY", err.message, { field: err.field });
    console.error("[api/scans] analysis failed", err);
    return apiError(500, "ANALYSIS_FAILED", "The analysis could not be completed. Please try again.");
  }
}

const listQuery = z.object({
  type: z.enum(ENTITY_TYPES).optional(),
  level: z.enum(RISK_LEVELS).optional(),
  q: z.string().trim().max(200).optional(),
  target: z.string().trim().max(300).optional(),
  brand: z.string().trim().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().max(64).optional(),
});

/** GET /api/scans — scan history with filters & cursor pagination. */
export async function GET(req: Request) {
  const params = Object.fromEntries(new URL(req.url).searchParams);
  for (const k of Object.keys(params)) if (params[k] === "") delete params[k];
  const parsed = listQuery.safeParse(params);
  if (!parsed.success) return zodToApiError(parsed.error);
  try {
    return NextResponse.json(await listScans(parsed.data));
  } catch (err) {
    console.error("[api/scans] list failed", err);
    return apiError(500, "DB_ERROR", "Could not load scan history.");
  }
}
