# ADR 0044 — Security baseline + supply chain: runtime hardening defaults, CI gates, ASVS L2 mapping

**Status:** Accepted (2026-06-11). Implemented (runtime baseline live since
Phases 2–5; CI gates live in this phase).

## Context

Derived projects inherit whatever security posture the skeleton ships on day
one — and security retrofits are the most expensive kind. Two failure modes to
prevent: (a) each project re-deriving the same hardening (headers, cookies,
CSRF stance, rate limits) inconsistently, and (b) supply-chain risk arriving
silently through the dependency graph (the `better-auth` CVE-2025-61928
history and the 2025 npm worm wave made this concrete). The runtime controls
were built across Phases 2–5 (ADRs 0033/0035/0039/0040); what was missing was
the CI enforcement layer and one honest, written-down statement of what the
baseline IS and ISN'T.

## Decision

**Runtime baseline** (consolidating what prior ADRs decided, as one checklist):
`@fastify/helmet` global; Fastify `bodyLimit` 1 MB default; `trustProxy`
env-driven (off by default, ON behind the proxy); Better Auth cookies
httpOnly + SameSite=Lax + Secure/`__Host-` in production; two-layer rate
limiting (Redis-backed default tier on Nest routes, strict per-IP tier on
`/api/auth/*`, fail-open on Redis outage by design); zod validation AND
serialization on every route; PII-registry-driven log redaction; secrets via
env only (zod-validated, fail-fast — env injection is the secrets-manager
seam). CSRF: Better Auth origin-check on its routes; `/v1` mutations rely on
SameSite + the same-origin proxy topology, with a cross-origin-rejection
integration test owed by the Testcontainers suite.

**Supply-chain gates in CI** (`.github/workflows/ci.yml`):

- **gitleaks** — gitleaks-action v3; incoming-range scan on PR/push, full
  history on `workflow_dispatch` (`fetch-depth: 0`). Also a lefthook
  pre-commit hook that **degrades gracefully** when the binary is absent
  (echo + skip — local DX must not require a Go binary; CI is the gate).
  Shared config `.gitleaks.toml`: allowlists are test-fixture _paths_ only
  (the telemetry scrubber fixtures are deliberately secret-shaped); a real
  leak is rotated, never allowlisted.
- **`pnpm audit --audit-level=high --prod` as a hard gate** — upgraded from
  the Phase-0 advisory job. Allowlist mechanism: `auditConfig.ignoreCves` /
  `ignoreGhsas` in `pnpm-workspace.yaml`, every entry commented (advisory
  link, reason, revisit date). Dev-only advisories are out of scope by
  `--prod`; Renovate keeps them visible.
- **docker-build + trivy** — the api image (`docker/api.Dockerfile`) is built
  with buildx + GHA layer cache (no push; CI validates the contract), then
  scanned by trivy-action: `CRITICAL,HIGH`, `ignore-unfixed` (unfixed
  base-image CVEs are noise with no action), exit-code 1. Allowlist:
  `.trivyignore` with comment + revisit date per CVE.
- Already-on layers reaffirmed as part of this decision: pnpm 11
  `minimumReleaseAge` (publish-delay quarantine), `allowBuilds` build-script
  denial, Renovate weekly cadence, exact pins for CVE-history packages.

**`SECURITY.md`** is the single statement of the baseline: every control
mapped to the file that implements it, a one-pass **OWASP ASVS 4.0.3 Level 2**
chapter mapping, and — the load-bearing part — explicit _Conscious exclusions_
(MFA, RBAC, WAF, AV, SBOM, DAST, secrets manager, at-rest crypto) and _Tracked
gaps_, so the document can be trusted precisely because it admits what's
missing. Same-phase but separate concern: the `integration` and `smoke-e2e`
CI jobs (spec §14) landed in the same workflow; they are testing
infrastructure, not part of this ADR's decision.

## Consequences

- A red supply-chain job is always actionable: bump (Renovate), or allowlist
  with a written reason + revisit date in the one documented place per gate.
  Immediate proof: the audit gate is born red — `next` 16.2.1 carries high
  advisories fixed in 16.2.6 — and the catalog bump is the fix, not a config
  change.
- The trivy/audit gates will occasionally block on upstream releases; the
  allowlist-with-expiry mechanism is the pressure valve, and `ignore-unfixed`
  keeps the image gate limited to actionable findings.
- gitleaks-action needs `GITLEAKS_LICENSE` (free) once the repo lives in a
  GitHub organization; personal-account repos run without it.
- ASVS is mapped once at chapter level, honestly, instead of a per-requirement
  spreadsheet nobody maintains; derived projects doing formal compliance start
  from the table and deepen only where their assessor requires.
- The pre-commit secret scan is best-effort by design (binary optional);
  the guarantee lives in CI.
