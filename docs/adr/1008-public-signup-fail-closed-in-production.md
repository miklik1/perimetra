# ADR 1008 — Public self-serve sign-up is fail-closed in production

**Status:** Accepted (2026-07-16) — **Skeleton-authored (channel-A drain of `7e9ba3b`); HQ-ruled, Martin ratify queued.**

## Context

Better Auth's `emailAndPassword` provider mounts a public account-minting route at `/api/auth/sign-up/email`. In the perimetra tenancy model (ADR 0055 / 0057 / 0063) a genuinely-new sign-up auto-provisions its own organization + owner membership on first session — so an anonymous sign-up is not merely a login, it silently creates a tenant. Left open in production, that is an unauthenticated org-creation surface: anyone can mint an account (and a workspace) with no operator and no invitation.

Every other account path is already gated — `admin.createUser` needs an authenticated operator with permission, and invite-accept needs an existing pending invitation — so public sign-up is the one remaining anonymous minting door.

Sign-up must stay OPEN outside production: the dev stack, the integration suite (`auth.itest.ts`) and e2e all create accounts through it, and `NODE_ENV=test` in particular must not close it.

## Decision

`emailAndPassword.disableSignUp` is set to `!allowSelfSignUp(env)`, where the pure policy function is:

```ts
allowSelfSignUp(env) = env.NODE_ENV !== "production" || env.AUTH_SELF_SIGN_UP;
```

Public sign-up is therefore a **denylist on production**: open for every `NODE_ENV` except `production`, and in production CLOSED by default unless `AUTH_SELF_SIGN_UP=true` re-opens it for a deliberate provisioning window. The gate keys on `NODE_ENV=production` — the api's production signal, the same one `assertProductionSecrets` and the `__Host-` secure-cookie switch already trust (a deploy intending production sets it regardless).

`AUTH_SELF_SIGN_UP` is a `z.enum(["true","false"]).default("false").transform((v) => v === "true")` env — a string enum transformed to a boolean, deliberately NOT `z.coerce.boolean` (which reads any non-empty string, `"false"` included, as truthy).

## Consequences

- Production ships with the anonymous account/tenant-minting surface CLOSED by default; `admin.createUser` and invite-accept remain the account paths. Closing sign-up does not strand tenancy: org auto-provisioning runs on session-create (ADR 0055 / 0063 `databaseHooks`), so an operator-created user still gets its org on first login.
- A denylist (not an allowlist) is deliberate: a forgotten `NODE_ENV` defaults to `development`, i.e. OPEN — but the one environment that MUST be closed (production) is the one whose signal every real deploy sets explicitly. The allowlist form (open only for an enumerated set) was rejected — it would close `NODE_ENV=test` and break `auth.itest.ts` for no production gain.
- Sign-in, password reset, email verification and invite-accept are separate Better Auth routes and are unaffected — this closes only the anonymous account-minting surface.
- The pure `allowSelfSignUp` and the resolved `emailAndPassword.disableSignUp` are unit-tested (`auth.instance.test.ts`): the production-default-CLOSED case is pinned so the fail-closed default can never silently regress.

## Sources

- Skeleton `7e9ba3b` (upstream ADR 1008) — drained by content, re-authored here with the perimetra tenancy interaction (the upstream ADR file is never cherry-picked).
- Engineering finding: "A disabled sign-up route is not a closed account surface — audit every minting path" (Mercata CAR-146 precedent).
- ADR 0055 (org-scope activation) / ADR 0063 (new-org default provisioning) — the auto-provisioning that makes an anonymous sign-up a tenant creation.
