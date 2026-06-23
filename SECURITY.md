# Security baseline

The skeleton's as-built security posture (ADR 0044, spec §13). Every claim
below maps to code or CI that exists in this repo — if something is not
implemented, it is listed under [Conscious exclusions](#conscious-exclusions)
or [Tracked gaps](#tracked-gaps), not implied. Derived projects inherit this
baseline and own everything in those two lists.

## Reporting a vulnerability

This is a template repository. For the skeleton itself, open a private
[GitHub security advisory](https://docs.github.com/en/code-security/security-advisories)
on the repo. **Derived projects must replace this section** with their own
contact and disclosure policy when stamping out.

## Runtime baseline

### Topology: same-origin by construction

The browser talks ONLY to the web origin. `next.config.js` rewrites
`/api/auth/*` (Better Auth) and `/api/v1/*` to the API service server-side
(`API_URL`, never exposed to the client), so the session cookie stays
first-party and CORS is never opened (design §9). There is no CORS
configuration on the API — that is deliberate: nothing cross-origin is
supposed to reach it.

### HTTP security headers

- **Web** (ADR 0026): a per-request **nonce-based CSP** is minted in
  `apps/web/proxy.ts` (strict `script-src 'self' 'nonce-…'`, no
  `unsafe-inline` for scripts; `frame-ancestors 'self'`); the static set —
  HSTS (2y, preload), `X-Content-Type-Options`, `X-Frame-Options: DENY`,
  `Referrer-Policy`, `Permissions-Policy` (camera/mic/geolocation denied) —
  lives in `apps/web/next.config.js`. Tested in
  `apps/web/e2e/security-headers.spec.ts`.
- **API**: `@fastify/helmet` registered globally in `apps/api/src/main.ts`
  (default helmet header set).

### Sessions & cookies

Better Auth cookie sessions (ADR 0033, `apps/api/src/modules/auth/auth.instance.ts`):
`httpOnly`, `SameSite=Lax`, `Secure` in production, and **`__Host-` prefixed
names in production** (browser-enforced Secure + `Path=/` + no `Domain`).
Session storage is Postgres with a Redis secondary store; the signed cookie
cache is capped at 5 minutes, so revocation propagates within that window.
Single-use credentials are consumed atomically (`GETDEL`).

### CSRF stance (documented, two halves)

1. `/api/auth/*` (Better Auth's own routes): Better Auth's origin check,
   allowlisted to `WEB_ORIGIN` only (`trustedOrigins` in `auth.instance.ts`).
2. `/v1/*` mutations: cookie auth relies on **`SameSite=Lax` + the same-origin
   proxy topology** above — no token machinery. A cross-site POST from another
   origin doesn't carry the session cookie (SameSite), and the API origin is
   not reachable cross-origin by design.

The Testcontainers suite (`apps/api/test/auth.itest.ts`) exercises the auth
routes with the trusted `origin` header; an explicit
cross-origin-mutation-must-fail test is a **tracked gap** (below).

### Rate limiting (two layers — `apps/api/src/common/throttle/throttle.module.ts`)

- **Default tier** on all Nest controller routes: global `ThrottlerGuard`,
  Redis-backed (shared across replicas), 100 req / 60 s by default
  (`THROTTLE_TTL_MS` / `THROTTLE_LIMIT`); per-route overrides via
  `@Throttle()` / `@SkipThrottle()`.
- **Auth tiers** on the raw `/api/auth/*` routes (outside Nest's router),
  `@fastify/rate-limit` per-IP, selected by exact path + method (never a
  raw-URL substring — that would let a query-string smuggle the generous tier):
  credential POSTs get the **strict** tier, 10 req / min by default
  (`AUTH_RATE_LIMIT_MAX`); the high-frequency session-management flow on
  `/get-session` (the `GET` read **and** the client's `POST` session-refresh)
  gets a **generous** tier, 300 req / min by default
  (`AUTH_SESSION_RATE_LIMIT_MAX`), so a polling web client never trips into a
  spurious logout (ADR 0044 amendment). `skipOnError: true` — a Redis outage fails OPEN (loudly) rather
  than locking everyone out; this trade-off is deliberate.

An api-key tier exists only as a seam (the Better Auth api-key plugin is OFF
until a project needs it).

### Input & output validation (ADR 0039, `apps/api/src/common/api/zod.ts`)

- Global zod validation pipe: every `@Body()`/`@Query()`/`@Param()` is parsed
  against its DTO schema; failures return the 422 envelope, never internals.
- **Mandatory zod response serialization**: `ZodSerializerInterceptor` strips
  everything not declared in the response DTO — over-exposure and accidental
  PII leakage are off by default, not by discipline. Serialization mismatches
  surface as opaque 500s (the exception filter never echoes zod internals).
- Fastify **body limit 1 MB** by default (`BODY_LIMIT_BYTES`,
  `apps/api/src/common/config/env.ts`).
- `trustProxy` is env-driven and **off by default**; it must be enabled behind
  the proxy/LB so rate limiting and logs see real client IPs (documented on
  the env var itself).

### Secrets: env-only (12-factor)

All configuration enters through one zod-validated schema
(`apps/api/src/common/config/env.ts`; `@repo/config` for web/mobile), parsed
once at boot — an invalid env crashes the process before it accepts traffic.
No secrets-manager lock-in: env injection IS the seam; any manager that can
populate process env (Doppler, SOPS, platform secrets) plugs in without code
changes. Dev defaults are obvious placeholders (`dev-secret-change-me`) that
only work against the local compose stack; production deploys must set real
values. No secret is read anywhere except via the env schema.

### Logging, PII & data protection (ADRs 0036/0040)

- pino redaction (`apps/api/src/common/logging/redaction.ts`): auth material
  (`authorization`, `cookie`, `set-cookie`) plus **every column declared
  `pii()` in the schema registry** is redacted from request/response logs —
  declaring a column PII is the only step.
- Sentry events are scrubbed against the same philosophy
  (`packages/telemetry/src/scrub.ts`: bearer tokens, JWTs, emails, national
  ID shapes).
- GDPR plumbing: privacy export/erase fan-out, append-only audit log,
  retention jobs, IDs-only job payloads ("Redis is ephemeral") — ADR 0040.

### Operational surfaces

- bull-board (`/admin/queues`) mounts in **non-production only**, behind basic
  auth (ADR 0043).
- Admin capability is the Better Auth admin plugin (ban/unban, impersonation)
  gated by the user's role; there is **no further RBAC/policy layer** —
  derived projects add their own authorization model on top of the session
  guard (`apps/api/src/modules/auth/session.guard.ts`).

## Supply chain (CI gates — `.github/workflows/ci.yml`, ADR 0044)

| Gate                  | Where                                                                                                  | Policy                                                                                            | Allowlist mechanism                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Secret scan           | `gitleaks` job (gitleaks-action v3) + lefthook pre-commit (skips gracefully when the binary is absent) | PR/push: incoming commit range; `workflow_dispatch`: full history                                 | `.gitleaks.toml` — test-fixture **paths** only, never a real leak                                                         |
| Dependency audit      | `audit` job                                                                                            | `pnpm audit --audit-level=high --prod` is a **hard gate**                                         | `auditConfig.ignoreCves` / `ignoreGhsas` in `pnpm-workspace.yaml`, each entry commented with advisory link + revisit date |
| Image vulnerabilities | `trivy` job (scans the image `docker-build` produced)                                                  | `CRITICAL,HIGH`, `ignore-unfixed`, exit-code 1                                                    | `.trivyignore` at repo root (CVE per line, comment + revisit date); intentionally absent until the first justified entry  |
| Image build           | `docker-build` job                                                                                     | `docker/api.Dockerfile` must build (turbo prune → frozen lockfile → non-root `USER node` runtime) | —                                                                                                                         |
| Update hygiene        | `renovate.json`                                                                                        | weekly grouped non-major PRs, majors isolated, lockfile maintenance                               | —                                                                                                                         |
| Publish-delay         | pnpm 11 `minimumReleaseAge` (kept ON)                                                                  | newly published versions are quarantined before install                                           | temporary excludes documented inline in `pnpm-workspace.yaml`                                                             |
| Build scripts         | pnpm `allowBuilds` in `pnpm-workspace.yaml`                                                            | postinstall scripts denied by default; explicit allowlist                                         | the `allowBuilds` map itself                                                                                              |
| Known-CVE pins        | `better-auth` pinned EXACT (CVE-2025-61928 history); React pins via catalog                            | —                                                                                                 | —                                                                                                                         |

## OWASP ASVS 4.0.3 — Level 2 one-pass mapping

One honest pass, chapter level. "Baseline" = the skeleton ships a real
control; "Partial" = core shipped, named gaps; "Project" = consciously left to
derived projects; "N/A" = out of scope for this architecture.

| Chapter                                | Status   | What exists / why not                                                                                                                                                                                                                                    |
| -------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1 Architecture & Threat Modeling      | Partial  | Decisions + trade-offs recorded as ADRs (0031–0044); no formal threat model document.                                                                                                                                                                    |
| V2 Authentication                      | Partial  | Better Auth email+password, strict auth-route rate limit, exact version pin. **No MFA** (plugin off), email verification not enforced (`requireEmailVerification: false` until projects flip it), password policy is Better Auth's default.              |
| V3 Session Management                  | Baseline | Cookie sessions: httpOnly, SameSite=Lax, Secure + `__Host-` in prod; Redis-backed revocation; 5-min cookie-cache bound; single-use tokens consumed atomically.                                                                                           |
| V4 Access Control                      | Partial  | Session guard + admin role; **no resource-level RBAC/policy engine** — per-project. Tenancy isolation exists as a dormant seam (ADR 0041).                                                                                                               |
| V5 Validation, Sanitization & Encoding | Baseline | zod on every input, zod serialization on every output, 1 MB body limit, React/Next output encoding, nonce CSP backstop.                                                                                                                                  |
| V6 Stored Cryptography                 | Project  | Password hashing is Better Auth's (scrypt); everything else (at-rest encryption, KMS) is a deployment concern — managed Postgres/S3 encryption assumed, not enforced here.                                                                               |
| V7 Error Handling & Logging            | Baseline | Opaque error envelopes (no stack/zod internals), PII-registry-driven log redaction, Sentry scrubbing, append-only audit log.                                                                                                                             |
| V8 Data Protection                     | Baseline | `pii()` registry, GDPR export/erase, retention jobs, IDs-only job payloads (ADR 0040).                                                                                                                                                                   |
| V9 Communication                       | Project  | HSTS (preload) is set; TLS itself terminates at the platform/proxy — cert and cipher policy live in the deployment, not this repo.                                                                                                                       |
| V10 Malicious Code                     | Baseline | The supply-chain table above: secret scan, audit gate, image scan, publish-delay, build-script denial, Renovate.                                                                                                                                         |
| V11 Business Logic                     | Partial  | Idempotency-key replay, rate limiting, transactional outbox guarantee no double-effects; domain-specific abuse cases are per-project.                                                                                                                    |
| V12 Files & Resources                  | Partial  | Uploads via S3 presigned URLs only — content-type allowlist + 10 MB ceiling enforced in the signature (`apps/api/src/modules/storage/`), the API never proxies bytes; **no content sniffing/AV scanning** — per-project if user files are redistributed. |
| V13 API & Web Service                  | Baseline | Versioned REST, zod both directions, documented CSRF stance, throttling, OpenAPI generated from the same schemas.                                                                                                                                        |
| V14 Configuration                      | Baseline | Fail-fast env validation, env-only secrets, non-root container, dependency gates, debug surfaces (bull-board) excluded from prod.                                                                                                                        |

## Conscious exclusions

Decided, not forgotten (revisit per project):

- **MFA / WebAuthn** — Better Auth plugins exist; OFF until a project needs
  them.
- **OAuth / social login** — same.
- **RBAC / policy layer beyond the admin role** — authorization models are
  product decisions.
- **WAF, bot management** — platform concern.
- **AV / content scanning of uploads** — only needed when projects accept and
  redistribute user files.
- **SBOM publication & artifact signing** — image isn't published by CI yet;
  add alongside a release pipeline.
- **DAST / pen-testing** — per-project engagement, not CI.
- **Secrets manager integration** — env injection is the documented seam.
- **At-rest encryption enforcement** — assumed from managed Postgres/S3.

## Tracked gaps

Things the baseline still owes (in flight, honest list):

- **Cross-origin mutation integration test** — the CSRF stance above should be
  PROVEN by a Testcontainers test that a mutation with a foreign `Origin` (and
  a cookie) fails; the auth itests currently only exercise the happy
  same-origin path.
- **`pnpm audit` gate is red at adoption** — `next` 16.2.1 carries high
  advisories fixed in 16.2.6; the gate stays red until the catalog bump lands
  (this is the gate working as intended).
- Password-reset email delivery is a logged stub
  (`auth.instance.ts#sendResetPassword`) until its template lands.
