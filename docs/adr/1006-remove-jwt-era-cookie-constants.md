# ADR 1006 — Remove the dead JWT-era cookie constants from `@repo/config`

**Status:** Accepted (2026-07-12) — **HQ-ruled default, Martin ratify queued** (do-first doctrine 2026-07-12, ruling #3). Supersedes the identity-constant clause of [ADR 0010](0010-ui-state-zustand-store-package.md) and the parallel note in [ADR 0020](0020-i18n-next-intl-use-intl.md); the auth model is [ADR 0033](0033-better-auth.md) (Better Auth cookie sessions, which superseded ADR 0016's client half).

## Context

`packages/config/src/constants.ts` defined three JWT-era constants: `ACCESS_TOKEN_COOKIE` (`"access_token"`), `REFRESH_TOKEN_COOKIE` (`"refresh_token"`), and `ACCESS_TOKEN_TTL_MS` (`15 * 60_000`). They date from the pre-0033 short-lived-JWT + refresh-cookie model (ADR 0016).

ADR 0010 and ADR 0020 both justify keeping them in the shared `@repo/config` with the same sentence: "kept because `@repo/api-mocks` consumes them and the DAG forbids `api-mocks → auth`, so config is their only legal common home." **That justification is stale.** A repo-wide grep (verified 2026-07-12, by import not string-match) finds zero runtime consumers of any of the three anywhere in `apps/*` or `packages/*`. The one MSW auth mock the justification points to — `packages/api-mocks/src/handlers/auth.ts` — moved to the Better Auth session-cookie model (ADR 0033): it defines its own local `SESSION_COOKIE_NAME`/`SESSION_TTL_S` and its header comment states outright "the short-lived-access-token model is gone." `ACCESS_TOKEN_TTL_MS`'s only reference is a test asserting its numeric value — no consumer exercises it. (Note: `packages/db`'s `account` table has columns literally named `access_token`/`refresh_token` — those are Better Auth's own OAuth-provider-token storage, unrelated to these cookie-name constants.) The dead code survived `pnpm knip` only because a package's own barrel export is treated as public API surface, not dead code.

## Decision

Remove all three constants from `constants.ts`, drop the `ACCESS_TOKEN_TTL_MS` assertion from `constants.test.ts`, drop the export bullets and fix the stale usage example in `packages/config/README.md`, and correct the one dangling code comment in `packages/i18n/src/config.ts` that referenced `ACCESS_TOKEN_COOKIE`.

`ACCESS_TOKEN_TTL_MS` is removed alongside the two cookie constants: ruling #3 asked for the cookie constants removed and the TTL's justification **re-verified** — the re-verification found it equally dead (stale justification, zero consumers), so under the clean-slate / no-just-in-case rule it goes too.

The historical ADRs (0010, 0020, 0016) and the i18n design spec are left untouched per the repo's "supersede, don't edit history" convention — this ADR is the superseding record; it quotes their now-false passages so the removal is traceable.

## Consequences

- `@repo/config` no longer ships dead auth constants. Anything the platform genuinely needs for cookies now comes from Better Auth (ADR 0033), which owns the real cookie names at runtime.
- **HQ-ruled default (ratify queued):** removal (and including the TTL constant) is HQ's call under the do-first doctrine and the clean-slate rule; Martin's ratification/veto is queued in the Brain hub. Fully reversible — the constants and their history are one `git revert` away.
- Follow-up (not blocking): the three stale "api-mocks consumes them" passages (ADR 0010, ADR 0020, the 2026-06-04 i18n design spec) now point at nothing; a future docs pass may redirect them here.

## Sources

- Vault decision: "do-first doctrine & blocker triage (2026-07-12)", ruling #3.
- Engineering finding: "Auth-stack migration leaves dead validator-endpoint-mock-comment residue" (item 5b — the two dead cookie constants + the stale TTL justification).
- [ADR 0033](0033-better-auth.md) — the auth model that made these constants dead.
