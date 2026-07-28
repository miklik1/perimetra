import { headers } from "next/headers";

import { hasSessionCookie } from "@repo/auth";

/**
 * The server's first-paint auth hint (ADR 0135): does THIS request carry a
 * Better Auth session cookie? Read once in the root layout and handed down to
 * `<AuthProvider initiallyAuthenticated>`, so `AuthGuard` and the app shell can
 * paint the authenticated layout on the first byte instead of shipping every
 * protected surface's loading fallback and swapping it after hydration.
 *
 * PRESENCE ONLY — exactly what the request-time proxy gate already trusts
 * (apps/web/proxy.ts), and for the same reason: validating the cookie needs the
 * API service, and this must never authorize anything. A stale or revoked
 * cookie returns `true` here and the guard bounces it a tick later, once Better
 * Auth's session actually resolves.
 *
 * Deliberately NOT a `/v1/me` call: a round trip on the root layout would put
 * every route — including the public ones — behind a request to the API, and it
 * would buy no additional safety, since the answer is still only a hint by the
 * time the browser acts on it.
 *
 * `headers()` is already read in the root layout for the CSP nonce, so this
 * adds no new dynamic-rendering opt-in.
 */
export async function hasSessionCookieHint(): Promise<boolean> {
  const cookie = (await headers()).get("cookie") ?? "";
  // `hasSessionCookie` takes a `Request` (Better Auth's `getSessionCookie`
  // signature); the URL is a throwaway — only the Cookie header is read.
  return hasSessionCookie(new Request("http://session-hint.internal/", { headers: { cookie } }));
}
