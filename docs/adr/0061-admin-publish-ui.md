# ADR 0061 — Admin publish UI

**Status:** Accepted (2026-06-16). Implemented. The web surface for the
admin-gated publish endpoints (ADR 0053 stores + [ADR 0056](0056-rbac-roles.md)
admin gate); sibling of [ADR 0060](0060-api-served-catalog.md) (which made the
web _read_ the catalog from the api). Closes the "publish is API-only
(curl/seed)" gap.

## Context

After ADR 0060 the web reads the catalog from the api, but the only ways to
_publish_ a catalog version, release, or price table were the seed script or raw
HTTP. Vendor model data (`Catalog`, `ProductModelRelease`) is authored as JSON
and validated server-side at publish (the I2 `validateRelease` gate returns a
structured `defects[]`; a bad `initialInput` returns `issues[]`); the price table
is a small structured shape. An admin needs a browser surface that drives the
existing endpoints and surfaces those validation failures legibly.

## Decision

- **A single admin-gated `/admin` page.** `/admin` is added to the proxy
  `PROTECTED_PREFIXES` (auth gate). The RSC prefetches `me()` and the client
  reads `me?.role === "admin"` to show the publish surface — the exact pattern
  `/team` uses. The gate is UX only: the publish endpoints are
  `@RequireRole('admin')`, so a non-admin POST 403s regardless (no FE-only
  authority).

- **JSON for vendor data, a form for the price table.** Catalog + release publish
  are `<textarea>` JSON paste (vendor authoring is JSON), parsed with a
  try/catch that surfaces a clean "invalid JSON" message _before_ the request.
  The price table gets a structured form (currency select, effective-date
  pickers, margin-floor/DPH/reverse-charge fields, + JSON for the `table`/`cost`
  bodies). A read-only "what's published" list sits above each form (an admin
  checks which `catalogVersion` a release can pin before publishing).

- **Validation failures render structurally.** `apiFetch` throws an `ApiError`
  that carries the raw 422 body on its public `body` field. On a release publish
  the form reads `body.defects` (the I2 `validateRelease` defects:
  `where · code` + message) or `body.issues` (a bad `initialInput`), falling back
  to the error message — so the vendor sees exactly what to fix.

- **Publish mutations mint an Idempotency-Key.** Each POST goes through a
  `createAdminQueries(client)` factory built on `apiFetch` (mirroring
  `projects-queries.ts`): one `crypto.randomUUID()` per submit in the
  `Idempotency-Key` header (publish is expensive/irreversible — a double-submit
  must collapse), the request body validated with `publishXSchema.parse`, the
  response with the response schema. On success the form invalidates its list
  query so the published item appears.

## Consequences

- An admin can publish the full catalog/release/price-table set from the browser;
  the seed (ADR 0060) is now only the dev bootstrap, not the sole publish path.
- All copy is in the `admin` i18n namespace (cs source + en parity).
- No nav link yet — `/admin` is URL-reachable (no shared authed-nav component to
  hook into); an admin entry point is a trivial follow-up when a nav lands.
- Deferred: a release **retire**/deprecate action (the `status` column supports
  it; no endpoint yet), and richer authoring (a structured release editor vs raw
  JSON) — JSON paste is the honest MVP while releases are hand-authored.
- The forms trust the api's `validateRelease` gate (the body crosses as
  `z.unknown()`); the web runs no client-side model validation, so a structurally
  bad paste fails at the server with the defect list rendered — the intended flow.
