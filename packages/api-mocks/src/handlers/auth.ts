import { loginSchema, type User } from "@repo/validators";

import { MockHttpError, type MockRoute } from "../core/types";
import { createSession, destroySession, resolveSession } from "../fixtures/session";
import { createMockUser, findUserByEmail, findUserById } from "../fixtures/users";

/**
 * Auth mock routes speaking the Better Auth wire contract (ADR 0033), so a
 * skeleton with no backend demo-signs-in on the bundled fixtures the same way
 * the real stack does: the web client (`@repo/auth`, `authClient.signIn.email`
 * / `useSession` / `signOut`) hits `sign-in/email`, `sign-up/email`,
 * `get-session`, `sign-out` under `/api/auth`, plus the cookie-authed
 * `GET /v1/me` the account page reads. These replace the pre-0033 bearer-JWT
 * routes (`/auth/login`, `/auth/refresh`, `/v1/me` via `Authorization`); the
 * short-lived-access-token model is gone — auth is a single httpOnly session
 * cookie the server owns. Mock-only: no signing, no expiry, no revocation.
 */

/**
 * Non-production Better Auth session-cookie name. MUST equal the name
 * `better-auth`'s `getSessionCookie()` reads in dev — its default is
 * `cookiePrefix` (`"better-auth"`) + `"."` + `"session_token"` — because that
 * is exactly what `@repo/auth`'s `hasSessionCookie` checks for presence at the
 * Next proxy gate (`packages/auth/src/index.ts`). Mirror the exact-name
 * discipline used there for the prod `__Host-auth_session_token` name: a wrong
 * name here silently fails the gate under mock mode. Prod renames the cookie to
 * `__Host-auth_session_token` (`apps/api/.../auth.instance.ts`); the mock only
 * ever runs in dev, so the bare name is the one to set.
 */
const SESSION_COOKIE_NAME = "better-auth.session_token";
/** Mirrors `session.expiresIn` (7 days) — fidelity only; the mock never expires. */
const SESSION_TTL_S = 60 * 60 * 24 * 7;

function setSessionCookie(token: string): string {
  return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_TTL_S}`;
}

function clearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
}

function readCookie(headers: Headers, name: string): string | null {
  const cookie = headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

/**
 * Better Auth's `user` object as `sign-in` / `get-session` return it, mock-shaped:
 * the identity fields every web consumer reads (`id`/`email`/`name`/`createdAt`
 * — `useAuth` does `new Date(createdAt).toISOString()`, so `createdAt` must be a
 * valid ISO date) plus the standard Better Auth columns. The `admin()` /
 * `organization()` plugin fields (`role`/`banned`/`activeOrganizationId`…) are
 * intentionally OMITTED — the mock keeps no such state and nothing on web reads
 * them (and `/v1/me` strips them from the real backend too).
 */
function sessionUserView(user: User) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: true,
    image: null,
    createdAt: user.createdAt,
    updatedAt: user.createdAt,
  };
}

/**
 * Better Auth's `session` object for `get-session`. Nothing on web reads any
 * session field (only `data.user` and the cookie's presence), so this is
 * fidelity-only — enough to satisfy the `{ session, user }` shape.
 */
function sessionRecordView(user: User, token: string) {
  return {
    id: `mocksess-${user.id}`,
    token,
    userId: user.id,
    expiresAt: new Date(Date.now() + SESSION_TTL_S * 1000).toISOString(),
    createdAt: user.createdAt,
    updatedAt: user.createdAt,
  };
}

export const authRoutes: MockRoute[] = [
  {
    // POST /api/auth/sign-in/email — email+password sign-in. Sets the session
    // cookie and returns `{ redirect, token, user }` (real Better Auth includes
    // `url` only when a `callbackURL` is sent — the web form sends none).
    method: "POST",
    pattern: "/auth/sign-in/email",
    handler: async ({ getBody }) => {
      const parsed = loginSchema.safeParse(await getBody());
      // Better Auth returns an opaque 401 for both bad shape and bad creds — no
      // user enumeration. The web login form maps any 401 to the "check your
      // details" message (`authErrorMessageKey`), keyed on status not code.
      if (!parsed.success) {
        throw new MockHttpError(401, "INVALID_EMAIL_OR_PASSWORD", "Invalid email or password");
      }
      const credential = findUserByEmail(parsed.data.email);
      if (!credential || credential.password !== parsed.data.password) {
        throw new MockHttpError(401, "INVALID_EMAIL_OR_PASSWORD", "Invalid email or password");
      }
      const token = createSession(credential.user.id);
      return {
        data: { redirect: false, token, user: sessionUserView(credential.user) },
        headers: { "Set-Cookie": setSessionCookie(token) },
      };
    },
  },
  {
    // POST /api/auth/sign-up/email — creates the account and auto-signs-in.
    // This repo leaves email verification non-blocking (`auth.instance.ts`
    // `requireEmailVerification: false`), so sign-up mints a session at once,
    // exactly like the real backend. Returns `{ token, user }` (no `redirect`).
    method: "POST",
    pattern: "/auth/sign-up/email",
    handler: async ({ getBody }) => {
      const body = (await getBody()) as Record<string, unknown> | undefined;
      const parsed = loginSchema.safeParse(body); // reuses the email+password contract
      const name = typeof body?.name === "string" ? body.name.trim() : "";
      if (!parsed.success || !name) {
        throw new MockHttpError(400, "INVALID_BODY", "Invalid sign-up input");
      }
      if (findUserByEmail(parsed.data.email)) {
        // This config auto-signs-in, so a duplicate is a real 422 (not Better
        // Auth's enumeration-guard synthetic 200, which only fires when
        // verification is required or auto-sign-in is off).
        throw new MockHttpError(
          422,
          "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
          "User already exists. Use another email.",
        );
      }
      const user = createMockUser({
        name,
        email: parsed.data.email,
        password: parsed.data.password,
      });
      const token = createSession(user.id);
      return {
        data: { token, user: sessionUserView(user) },
        headers: { "Set-Cookie": setSessionCookie(token) },
      };
    },
  },
  {
    // GET /api/auth/get-session — the reactive probe `client.useSession()`
    // polls. Returns `{ session, user }` for a live session cookie, or the
    // literal `null` body (HTTP 200 — NOT 401) otherwise, matching Better
    // Auth. A malformed `user` here silently breaks `useAuth` (the finding's
    // flagged sharp edge), so the shape mirrors `sign-in` exactly.
    method: "GET",
    pattern: "/auth/get-session",
    handler: ({ headers, cookieLess }) => {
      const token = readCookie(headers, SESSION_COOKIE_NAME);
      const userId = resolveSession(token, cookieLess);
      const user = userId ? findUserById(userId) : undefined;
      if (!user) return { data: null };
      return {
        data: {
          session: sessionRecordView(user, token ?? `mocksess_${user.id}`),
          user: sessionUserView(user),
        },
      };
    },
  },
  {
    // POST /api/auth/sign-out — clears the session cookie; always 200
    // `{ success: true }`, even with no/unknown cookie (Better Auth never errors
    // here).
    method: "POST",
    pattern: "/auth/sign-out",
    handler: ({ headers, cookieLess }) => {
      destroySession(readCookie(headers, SESSION_COOKIE_NAME), cookieLess);
      return { data: { success: true }, headers: { "Set-Cookie": clearSessionCookie() } };
    },
  },
  {
    // GET /v1/me — the real API's URI-versioned profile route (NestJS
    // `MeController`, ADR 0033). NOT legacy: the account page still reads it via
    // `authQueries.me()`. Re-auths off the Better Auth session cookie now (was a
    // bearer JWT under ADR 0016).
    //
    // Perimetra widens the upstream `userSchema` projection: the client parses
    // this through `meResponseSchema` (ADR 0056/0062), which REQUIRES `role` and
    // `isPlatformAdmin`. Mock mode is single-tenant, so the mock user is their
    // own org's admin; `isPlatformAdmin` is fail-closed `false` — the vendor
    // console is a real-stack-only surface (no mock platform operator).
    method: "GET",
    pattern: "/v1/me",
    handler: ({ headers, cookieLess }) => {
      const userId = resolveSession(readCookie(headers, SESSION_COOKIE_NAME), cookieLess);
      const user = userId ? findUserById(userId) : undefined;
      if (!user) throw new MockHttpError(401, "UNAUTHENTICATED", "Authentication required");
      return { data: { ...user, role: "admin", isPlatformAdmin: false } };
    },
  },
];
