import { type NextRequest } from "next/server";

import { handleApiRequest } from "../../../lib/route-handler/handle-api-request";

/**
 * BFF route handler (ADR 0018) — the browser's HTTP entry to the shared
 * `handleApiRequest` transport (mock-or-proxy). The RSC/server client reaches the
 * same function in-process (no self-hop); see `lib/server-api.ts`. Node runtime:
 * the proxy/dispatch use Node APIs and must not run on the edge.
 */
export const runtime = "nodejs";

const handle = (request: NextRequest): Promise<Response> => handleApiRequest(request);

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
