import { NextResponse } from "next/server";
import { ZodError } from "zod";

export interface ApiErrorBody {
  error: { code: string; message: string; field?: string; retryAfterSec?: number };
}

export function apiError(status: number, code: string, message: string, extra: Partial<ApiErrorBody["error"]> = {}) {
  const headers: Record<string, string> = {};
  if (extra.retryAfterSec) headers["retry-after"] = String(extra.retryAfterSec);
  return NextResponse.json<ApiErrorBody>({ error: { code, message, ...extra } }, { status, headers });
}

export function zodToApiError(err: ZodError) {
  const first = err.issues[0];
  return apiError(400, "VALIDATION_ERROR", first?.message ?? "Invalid request", { field: first?.path.join(".") || undefined });
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
