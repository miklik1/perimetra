# ADR 0033 — Auth: Better Auth (cookie sessions) replaces custom JWT + refresh rotation

**Status:** Accepted (2026-06-10). Supersedes the client-side machinery of
[ADR 0016](0016-auth-jwt-refresh-package.md) / [ADR 0017](0017-auth-client-hardening.md);
amends [ADR 0018](0018-bff-route-handler-and-shared-mocks.md) (proxy topology).

## Context

ADR 0016/0017 implemented a custom JWT + rotating-refresh-token client with
considerable hardening (cross-tab Web Locks, single-flight refresh, cookie
persistence) — but no backend existed. With the NestJS backend (ADR 0031), the
owner chose Better Auth over implementing the custom contract server-side:
OAuth/2FA/organizations/passkeys become configuration rather than new
architecture, which compounds across ~10 derived projects.

## Decision

- **Better Auth, pinned EXACT** (1.6.16 at adoption). Policy: the package had a
  critical CVE in 2025 (unauthenticated API-key creation, fixed in 1.3.26) —
  exact pin, GitHub security advisories watched, **api-key plugin stays off**
  until a project needs it and reviews it.
- **Mounted manually on Fastify** (request-mapping handler registered via
  `HttpAdapterHost` for `/api/auth/*`, ahead of versioned routes). The
  community NestJS integration's Fastify support is beta; the manual mount is
  ~40 lines we fully control.
- **Drizzle adapter** over `@repo/db` (auth tables live in
  `@repo/db/schema/auth`: user/session/account/verification +
  organization/member/invitation); **Redis secondary storage** for session
  lookups (horizontal scale without a DB hit per request).
- **Cookie sessions** (httpOnly, `__Host-`/secure in production, cookieCache
  enabled) replace the access-JWT + refresh-rotation client machinery —
  token manager, refresh middleware, cross-tab locks, storage adapters are
  DELETED from `@repo/auth`; the public surface (`useAuth`, `AuthGuard`,
  provider) survives, reimplemented over `better-auth/react`'s `useSession`.
- **Plugins:** `admin()` on (ban + impersonation — the perennial client ask);
  `organization()` tables generated but dormant (the ADR 0041 tenancy seam);
  Expo client stubbed for the dormant mobile app.
- **Topology (amends ADR 0018):** Next.js `beforeFiles` rewrites proxy
  `/api/auth/*` and `/api/v1/*` to the api service (server-only target env) —
  same-origin cookies, no CORS; rewrites are gated off in mock mode so the
  ADR 0018 BFF mock handler keeps serving frontend-only dev. RSC reads the
  session by forwarding request headers. NestJS guards routes via
  `auth.api.getSession` (SessionGuard + `@CurrentSession()`).
- Email delivery (verification/reset) is a logger stub until the email module
  (Phase 4) replaces it.

## Consequences

- Sign-up → session cookie → guarded `/v1/me` proven live against the dev
  stack at integration time; suite green.
- `@repo/auth` shrinks dramatically; auth hardening responsibility moves to a
  maintained upstream — the trade is supply-chain vigilance (pin + advisories)
  instead of owning crypto-adjacent client code.
- Accepted risk: better-auth peers `drizzle-orm ^0.45` vs our `1.0.0-rc.3` —
  runtime-proven here, officially untested upstream; re-verify on either bump.
- Open follow-ups: throttle tiers on `/auth/*` (lands with the Redis throttler,
  Phase 4); `@repo/api-mocks` still mocks the OLD token contract — mock-mode
  auth needs Better Auth wire-contract handlers (tracked for Phase 5's
  conventions pass).
