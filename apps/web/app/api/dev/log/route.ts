import { NextResponse } from "next/server";

import { getApiLog } from "@repo/api";
import { env } from "@repo/config/env/web";

/**
 * Dev-only API-log inspector (ADR 0018 observability). Returns the in-memory
 * ring buffer the debug middleware records to when `NEXT_PUBLIC_DEBUG_API` is on.
 * 404s otherwise so it never exposes anything in production. Note: the buffer is
 * the SERVER process's — it captures RSC/in-process requests; the browser
 * client's debug middleware logs to the console (its own process).
 */
export const runtime = "nodejs";

export function GET(): Response {
  if (env.NEXT_PUBLIC_DEBUG_API !== "true") {
    return NextResponse.json({ message: "Not found", code: "NOT_FOUND" }, { status: 404 });
  }
  return NextResponse.json({ entries: getApiLog() });
}
