import { NextResponse } from "next/server";
import { toClientError } from "@/lib/errors";

export function apiError(error: unknown): NextResponse {
  const safe = toClientError(error);
  return NextResponse.json({ error: { code: safe.code, message: safe.message } }, { status: safe.status,
    headers: { "Cache-Control": "no-store", ...([409, 429, 503].includes(safe.status) ? { "Retry-After": safe.status === 429 ? "60" : "10" } : {}) } });
}
