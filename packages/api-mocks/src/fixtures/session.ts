/**
 * Mock stand-in for the backend's server-side session store. The real backend
 * (Better Auth, ADR 0033) keeps sessions in Redis; this store runs IN the runtime
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
 *
 * State lives on `globalThis` under a symbol rather than in a module-level Map,
 * because Next loads this module TWICE in one process: once under the
 * `react-server` export condition (RSC/server components, which reach the mock
 * in-process through `handleApiRequest` in `apps/web/lib/server-api.ts`) and
 * once in the normal Node graph (route handlers, i.e. the browser's `/api/*`
 * calls). Two module instances mean two Maps, so a session opened over the route
 * handler is invisible to the RSC read of the same session — `GET /v1/me` 401s
 * from every server component and no authed server render works under mock mode
 * at all. One store per process, shared across module graphs, is what the real
 * backend's Redis actually behaves like. Same singleton trick, same reason, as
 * `packages/api/src/middleware/api-log-store.ts`.
 */
interface MockSessionStore {
  sessions: Map<string, string>; // sessionToken -> userId
  lastSession: string | null;
}

const STORE_KEY = Symbol.for("@repo/api-mocks/session-store");
const globalRef = globalThis as typeof globalThis & { [STORE_KEY]?: MockSessionStore };

const store: MockSessionStore = (globalRef[STORE_KEY] ??= {
  sessions: new Map<string, string>(),
  lastSession: null,
});

// The Map itself is stable once created, so an alias is safe; `lastSession` is a
// rebound value and must be read and written through `store` every time.
const sessions = store.sessions;

/** Open a session for a user; returns the token to set as the session cookie. */
export function createSession(userId: string): string {
  const token = `mocksess_${userId}`;
  sessions.set(token, userId);
  store.lastSession = token;
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
  if (cookieLess && !token && store.lastSession) return sessions.get(store.lastSession);
  return undefined;
}

export function destroySession(token: string | null, cookieLess = false): void {
  // Under the BFF (cookieLess=false) a sign-out with no/unknown cookie resolves
  // to null and deletes nothing — harmless for a mock (memory-only, reset per
  // test; the cookie is cleared regardless), but noted so it's not mistaken for
  // real session revocation.
  const resolved = token ?? (cookieLess ? store.lastSession : null);
  if (resolved) sessions.delete(resolved);
  if (resolved === store.lastSession) store.lastSession = null;
}

/** Test helper — wipe all session state between cases. */
export function resetSessions(): void {
  sessions.clear();
  store.lastSession = null;
}
