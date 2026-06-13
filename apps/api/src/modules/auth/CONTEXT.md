# auth — Better Auth integration (ADR 0033)

Better Auth mounted **manually on the raw Fastify instance** at `/api/auth/*`
(no NestJS controller for those routes): email/password + verification +
reset, admin plugin (ban/impersonate), organization plugin ACTIVE (tenancy
scope, ADR 0041 seam activated by ADR 0055 — `databaseHooks` auto-provision one
org + owner membership per user and stamp every session's `activeOrganizationId`;
self-serve org creation stays off). Drizzle adapter over `@repo/db/schema/auth`; Redis secondary
storage for session lookups. Sessions are httpOnly cookies (`__Host-` prefix
in prod, `SameSite=Lax`); a strict per-IP rate limit guards `/api/auth/*`
(registered in `main.ts`, see `common/throttle`).

## Public surface

- `SessionGuard` + `@CurrentSession()` — how every protected route gets the
  session (verifies the cookie, no DB round-trip thanks to Redis storage).
- `AUTH` / `REDIS` DI tokens (`auth.tokens.ts`); `auth.instance.ts` builds the
  configured Better Auth instance (also consumed by `migrate`/CLI tooling).
- `me.controller.ts` — `/v1/me`, the canonical "who am I" endpoint.

## Must never

- Import another module's schema or services — auth is a leaf; domain modules
  depend on IT (via `SessionGuard`), never the reverse.
- Hand-roll session/token logic — Better Auth owns credentials, hashing,
  CSRF/origin checks on its own routes.
- Bypass the email module: verification/reset mail goes through `EmailService`.

Governing ADR: `docs/adr/0033-better-auth.md` (+ 0041 tenancy seam, 0055 activation).
