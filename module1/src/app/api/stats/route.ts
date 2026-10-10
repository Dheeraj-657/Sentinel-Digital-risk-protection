import { NextResponse } from "next/server";
import { dashboardStats } from "@/lib/scans";
import { apiError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await dashboardStats());
  } catch (err) {
    console.error("[api/stats]", err);
    return apiError(500, "DB_ERROR", "Could not load dashboard statistics.");
  }
}
