import { NextResponse } from "next/server";

import { logger } from "@repo/utils";

/**
 * Transparent reverse proxy to the real backend. The client and RSC only ever
 * see the same-origin `/api`; this hides the backend origin, forwards auth
 * (Authorization header + cookies) when `forwardCredentials` is set, streams
 * bodies both ways, and copies response headers — including every `Set-Cookie`
 * — faithfully (ADR 0018). Accepts a standard `Request` so it serves both the
 * HTTP route handler (`NextRequest`) and the in-process RSC client.
 *
 * Request headers are an explicit allowlist (not a denylist): only the safe,
 * known headers below are relayed upstream, so arbitrary client headers can't
 * leak through. Credential headers are gated separately (`CREDENTIAL_HEADERS`)
 * so the caller can refuse to relay bearer tokens / session cookies to an
 * unconfigured/untrusted origin (see `handle-api-request.ts`).
 */

// Always-safe headers relayed to any backend origin.
const ALLOWED_REQUEST_HEADERS = ["accept", "accept-language", "content-type", "user-agent"];

// Credential-bearing headers — only relayed when the caller opts in via
// `forwardCredentials` (i.e. a trusted, explicitly configured backend origin).
const CREDENTIAL_HEADERS = ["authorization", "cookie"];

// Hop-by-hop / connection headers must not be copied onto the proxied response.
const DISALLOWED_RESPONSE_HEADERS = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "content-encoding",
  "content-length",
]);

// Strip the mount prefix from a pathname, guarding on the `/` boundary so a
// prefix-adjacent path (e.g. `/apidocs` under `/api`) is left intact. Inlined
// (kept identical to @repo/api-mocks `core/dispatch.stripApiPrefix`) so the BFF
// proxy — which DOES ship to the production server bundle — carries zero
// dependency on the mock package and its demo fixtures (ADR 0018). The mock
// dispatcher applies the same normalisation on its own copy.
function stripApiPrefix(pathname: string, prefix?: string): string {
  if (!prefix) return pathname || "/";
  if (pathname === prefix) return "/";
  return pathname.startsWith(`${prefix}/`) ? pathname.slice(prefix.length) : pathname;
}

export interface ProxyOptions {
  /** Real backend origin, e.g. `https://api.example.com`. */
  backendBaseUrl: string;
  /**
   * Relay credential headers (Authorization + Cookie) upstream. Defaults to
   * `false` — a fail-safe posture so callers must explicitly opt in for a
   * trusted backend origin and never leak credentials to an unconfigured host.
   */
  forwardCredentials?: boolean;
  /** The mount prefix to strip before forwarding (default `/api`). */
  prefix?: string;
  timeoutMs?: number;
}

export async function proxyToBackend(request: Request, options: ProxyOptions): Promise<Response> {
  const {
    backendBaseUrl,
    forwardCredentials = false,
    prefix = "/api",
    timeoutMs = 30_000,
  } = options;
  const url = new URL(request.url);
  const path = stripApiPrefix(url.pathname, prefix);
  const backendOrigin = backendBaseUrl.replace(/\/$/, "");
  const target = `${backendOrigin}${path}${url.search}`;

  const allowed = forwardCredentials
    ? [...ALLOWED_REQUEST_HEADERS, ...CREDENTIAL_HEADERS]
    : ALLOWED_REQUEST_HEADERS;
  const headers = new Headers();
  for (const name of allowed) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  // Stream the request body through (no buffering). Only set `duplex` when there
  // is an actual stream body — a bodyless POST (e.g. /auth/logout) must not.
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const body = hasBody ? request.body : null;

  // Propagate the caller's cancellation (TanStack abort, unmount, navigation)
  // AND a timeout, so an aborted client request cancels the upstream fetch
  // instead of leaking a backend connection.
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]);

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body: body ?? undefined,
      ...(body ? { duplex: "half" } : {}),
      redirect: "manual",
      signal,
    } as RequestInit & { duplex?: "half" });
  } catch (error) {
    // Surface the swallowed upstream error to the structured logger before the
    // opaque 502 — otherwise proxy failures (DNS, refused, timeout) vanish.
    logger.error("Backend proxy failed", { error });
    return NextResponse.json(
      { message: "Upstream request failed", code: "BAD_GATEWAY" },
      { status: 502 },
    );
  }

  const responseHeaders = new Headers();
  for (const [name, value] of upstream.headers) {
    const lower = name.toLowerCase();
    if (lower === "set-cookie") continue; // handled below to preserve multiples
    if (DISALLOWED_RESPONSE_HEADERS.has(lower)) continue;
    if (lower === "location" && value.startsWith(backendOrigin)) {
      // An upstream redirect (`redirect: "manual"`) whose absolute Location
      // points back at the hidden backend origin would leak the internal
      // host:port to the browser — defeating the origin-hiding this proxy
      // exists for. Rewrite it to the same-origin BFF mount so only the path is
      // exposed; cross-origin Locations (OAuth providers, etc.) pass through.
      responseHeaders.set("location", `${prefix}${value.slice(backendOrigin.length)}`);
      continue;
    }
    responseHeaders.set(name, value);
  }
  // Preserve every Set-Cookie (forEach/iterator folds them into one value).
  for (const cookie of upstream.headers.getSetCookie()) {
    responseHeaders.append("set-cookie", cookie);
  }

  // Stream the response body; `upstream.body` is null for 204/304, so the
  // Response constructor no longer throws on null-body statuses.
  return new NextResponse(upstream.body, { status: upstream.status, headers: responseHeaders });
}
