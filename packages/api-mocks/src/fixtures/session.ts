/**
 * Mock stand-in for the backend's server-side session store. The real backend
 * (Better Auth, ADR 0033) keeps sessions in Redis; this Map runs IN the runtime
 * serving the mock — the Next BFF process (web/RSC/middleware) or the MSW
 * process (Expo/Vitest) — so, unlike a browser-only store, it's visible to
 * server-side reads. Keyed by the opaque session token that `sign-in`/`sign-up`
 * issue as the `better-auth.session_token` httpOnly cookie; `get-session` and
 * `/v1/me` resolve the current user from it. Mock-only; never a pattern for
 * real auth (no signing, no expiry, no revocation).
 *
 * `lastSession` is a cookie-less fallback for runtimes where the session token
 * doesn't ride a cookie (Expo/Vitest MSW): there, "the most recent sign-in"
 * stands in. Under the BFF (`cookieLess: false`) the cookie is authoritative.
 */
const sessions = new Map<string, string>(); // sessionToken -> userId
let lastSession: string | null = null;

/** Open a session for a user; returns the token to set as the session cookie. */
export function createSession(userId: string): string {
  const token = `mocksess_${userId}`;
  sessions.set(token, userId);
  lastSession = token;
  return token;
}

/**
 * Resolve the user id for a session token. Falls back to the most-recent
 * sign-in ONLY in cookie-less runtimes (Expo/Vitest MSW), where the token can't
 * ride a cookie. Under the BFF (`cookieLess: false`) the cookie is
 * authoritative — no fallback, so a missing/unknown cookie never resolves
 * another user.
 */
export function resolveSession(token: string | null, cookieLess = false): string | undefined {
  if (token && sessions.has(token)) return sessions.get(token);
  if (cookieLess && !token && lastSession) return sessions.get(lastSession);
  return undefined;
}

export function destroySession(token: string | null, cookieLess = false): void {
  // Under the BFF (cookieLess=false) a sign-out with no/unknown cookie resolves
  // to null and deletes nothing — harmless for a mock (memory-only, reset per
  // test; the cookie is cleared regardless), but noted so it's not mistaken for
  // real session revocation.
  const resolved = token ?? (cookieLess ? lastSession : null);
  if (resolved) sessions.delete(resolved);
  if (resolved === lastSession) lastSession = null;
}

/** Test helper — wipe all session state between cases. */
export function resetSessions(): void {
  sessions.clear();
  lastSession = null;
}
