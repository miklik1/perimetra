# ADR 0099 — Authz default-deny: global SessionGuard (APP_GUARD) + @Public() opt-out

**Status:** Accepted (2026-07-03). Implemented.

> Drained from **skeleton ADR 0045** (channel A, `adb8fa5`) and renumbered —
> perimetra's 0045 is the Expr numeric domain. Future upstream commits citing
> "ADR 0045" in auth code refer to THIS decision.

## Context

Authentication was opt-in: every controller had to remember
`@UseGuards(SessionGuard)`. A hand-written controller that forgot the
decorator shipped **public** — and hand-rolling happens despite the
generator-first rule (the storage controller predates the DTO convention and
proves it). Review flagged this as a MAJOR finding: the failure mode of the
convention is silent exposure, the worst possible default for a template
whose derived projects inherit day-one posture (ADR 0044).

## Decision

**Default-deny at the framework layer.** `SessionGuard` is registered as a
global `APP_GUARD` in `app.module.ts`; it runs on every Nest route after the
global `ThrottlerGuard` (same throttle-then-auth order as before). Behavior on
authed paths is unchanged: session attach for `@CurrentSession()`, 401
ApiError envelope without one.

**`@Public()` is the explicit opt-out** (`modules/auth/public.decorator.ts`:
`SetMetadata`, read via `Reflector.getAllAndOverride` — handler first, then
class). Only deliberately anonymous routes carry it, each with a one-line
justification: the health controller (orchestrators probe
`/health/live`/`ready` without credentials) and perimetra's anonymous buyer
surface `QuotesPublicController` (`/v1/quotes/shared/:shareToken` +
accept/decline, ADR 0083/0089 — the unguessable share token IS the
credential; its class-level `@Throttle` still applies because the
ThrottlerGuard is a separate global guard). Anything ambiguous stays
protected — a wrongly-guarded public route fails loudly with a 401; a
wrongly-public protected route fails silently.

**Guard composition (perimetra-specific):** `RolesGuard` / `PlatformGuard`
stay as class/handler guards on top of the global session layer — Nest runs
global → class → handler, so `sessionContext` is always attached before they
read it. The formerly-composed `@UseGuards(SessionGuard, X)` controllers drop
the redundant `SessionGuard` (it would run `getSession` twice per request)
and keep only `X`. The `pnpm gen module` template scaffolds
`@UseGuards(RolesGuard)` — a generated org-scoped module keeps org-role
resolution/enforcement, not just session auth.

Out of Nest's router (unaffected by design): the Better Auth mount
(`/api/auth/*`, ADR 0033) and the dev-only `/openapi.json` — both registered
straight on Fastify.

**Alternative considered — a local ESLint rule** requiring `@UseGuards` on
every `@Controller` class. Rejected as the primary control: lint is advisory
(warnings get ignored, `eslint-disable` is one line), it greps the AST rather
than the runtime (a decorator applied via variable or re-export escapes it),
and new file types/codegen paths outside the lint glob escape it entirely.
The guard binds at the composition root, so no controller can exist outside
it. The rule remains a possible belt-and-braces addition (catching a stray
`@UseGuards(SessionGuard)` that the global guard makes redundant), not a
substitute.

## Consequences

- Controllers and the `pnpm gen module` template drop
  `@UseGuards(SessionGuard)` — the scaffold gets one decorator shorter, and
  the convention can no longer be forgotten, only explicitly opted out of.
- `AuthModule` keeps exporting `SessionGuard` for method-level reuse, but the
  canonical instance lives at the app root (`useClass` resolves `AUTH` via the
  imported `AuthModule`).
- Every new public endpoint is now a visible, greppable decision
  (`grep @Public`), reviewable in isolation.
- Guard unit tests boot the APP_GUARD wiring exactly like production
  (`session.guard.test.ts`) and pin both the default-deny 401 and the
  `@Public()` skip (no session lookup).
