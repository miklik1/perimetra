/**
 * The mock's stand-in for the backend's server-side refresh store. Runs IN the
 * runtime serving the mock — the Next BFF process (web/RSC/middleware) or the
 * MSW process (Expo/Vitest) — so, unlike the old browser-only `localStorage`
 * version, it's visible to server-side reads. Keyed by the opaque refresh token
 * that login issues as an httpOnly cookie; `/auth/refresh` re-mints an access
 * token from it, demonstrating the silent-refresh path. Mock-only; never a
 * pattern for real auth.
 *
 * `lastSession` is a cookie-less fallback for runtimes where the refresh token
 * doesn't ride a cookie (Expo MSW dev): there, "the most recent login" stands in.
 */
const sessions = new Map<string, string>(); // refreshToken -> userId
let lastSession: string | null = null;

/** Open a session for a user and return the refresh token to set as a cookie. */
export function createSession(userId: string): string {
  const refreshToken = `mockrt_${userId}`;
  sessions.set(refreshToken, userId);
  lastSession = refreshToken;
  return refreshToken;
}

/**
 * Resolve the user id for a refresh token. Falls back to the most-recent login
 * ONLY in cookie-less runtimes (Expo/Vitest MSW), where the refresh token can't
 * ride a cookie. Under the BFF (`cookieLess: false`) the cookie is authoritative
 * — no fallback, so a missing/expired cookie never resolves another user.
 */
export function resolveSession(
  refreshToken: string | null,
  cookieLess = false,
): string | undefined {
  if (refreshToken && sessions.has(refreshToken)) return sessions.get(refreshToken);
  if (cookieLess && !refreshToken && lastSession) return sessions.get(lastSession);
  return undefined;
}

export function destroySession(refreshToken: string | null, cookieLess = false): void {
  // Under the BFF (cookieLess=false) a logout with no/expired cookie resolves
  // `token` to null and deletes nothing — the in-memory session is orphaned.
  // Harmless for a mock (memory-only, reset per test; the cookie is cleared
  // client-side regardless), but noted so it's not mistaken for real logout.
  const token = refreshToken ?? (cookieLess ? lastSession : null);
  if (token) sessions.delete(token);
  if (token === lastSession) lastSession = null;
}

/** Test helper — wipe all session state between cases. */
export function resetSessions(): void {
  sessions.clear();
  lastSession = null;
}
