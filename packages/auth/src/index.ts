import { getSessionCookie } from "better-auth/cookies";

// Server-safe barrel (`@repo/auth`). A thin Better Auth client wrapper; the
// React surface (provider, hooks, guard) lives behind the `"use client"`
// boundary in `./react` (`@repo/auth/react`) and is intentionally NOT
// re-exported here (mirrors `@repo/api`). The ADR 0016/0017 token-manager /
// refresh-middleware machinery is superseded by cookie sessions (design
// §7.1/§9): the browser carries an httpOnly session cookie through the
// same-origin proxy, and the API service owns refresh.

export { createAuthClient } from "./client";
export type { AuthClient, AuthClientOptions } from "./client";

/**
 * The production session-cookie name. Better Auth renames the session cookie to
 * the `__Host-` prefix in production (`apps/api/.../auth.instance.ts`
 * `advanced.cookies.session_token`), which `getSessionCookie()` — called
 * config-less here — does NOT know about (it only checks the bare + `__Secure-`
 * default names). MUST stay in lockstep with the API's cookie config; a mismatch
 * locks authenticated production users out.
 */
const PROD_SESSION_COOKIE_NAME = "__Host-auth_session_token";

/**
 * Optimistic session-cookie PRESENCE check for the request-time gate
 * (apps/web/proxy.ts) — explicitly NOT validation; it must never authorize
 * anything, the API service stays the authority. Covers every spelling the app
 * issues: the bare + `__Secure-` names via `getSessionCookie`, plus the
 * production `__Host-` name. Works for any `Request` (incl. `NextRequest`).
 */
export function hasSessionCookie(request: Request): boolean {
  if (getSessionCookie(request) !== null) return true;
  const cookie = request.headers.get("cookie") ?? "";
  return cookie.includes(`${PROD_SESSION_COOKIE_NAME}=`);
}
