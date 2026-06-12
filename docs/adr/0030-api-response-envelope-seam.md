# ADR 0030 — API response-envelope seam in `createApiClient`

**Status:** Accepted (2026-06-10). Amends
[ADR 0007](0007-rest-data-layer.md) (REST data layer) and
[ADR 0012](0012-api-client-factory.md) (client factory).

## Context

`apiFetch` assumed the response body **is** the payload, and that error bodies
match one flat envelope (`apiErrorEnvelopeSchema`: `{ message, code, errors }`).
Real backends often wrap everything instead — the first migration target's API
returns `{ success: true, data: T, timestamp, version }` on 2xx and
`{ success: false, error: { code, message, details } }` on failure.

Without a seam, every endpoint definition would unwrap by hand (`.data`
sprinkled through every `parse`), and error normalization (ADR 0014's single
`ApiError` shape) would silently degrade to status-text messages for any
backend whose error body isn't the default shape.

## Decision

Add an optional **`envelope`** config to `createApiClient`
(`ResponseEnvelopeConfig`) — unwrapping happens once, transport-side, in the
one place that already owns body decoding:

- **`unwrap?: (data: unknown) => unknown`** — applied to every 2xx JSON body
  _before_ the per-call `parse`. Endpoint validators and call sites see the
  inner payload only; a throw is normalized into a `"parse"` `ApiError` (the
  body didn't match the envelope this client was configured for).
- **`mapError?: (body) => { message?, code?, fieldErrors? } | void`** — maps a
  non-2xx JSON body onto `ApiError` fields. Returning `undefined` falls back
  to the default envelope schema, then to the HTTP status text; the raw body
  always lands on `ApiError.body`.

Both are client-level (per `createApiClient` call), not per-request: an
envelope is a property of a backend, and each runtime already constructs its
own client (ADR 0012). A project talking to two backends with different
envelopes builds two clients.

## Consequences

- Endpoint definitions stay envelope-blind — the OpenAPI-or-hand-written swap
  (ADR 0019) and any future backend change touch one config object, not every
  endpoint.
- `ApiError`'s taxonomy (ADR 0014) keeps full fidelity (`code`,
  `fieldErrors`) on enveloped backends — paywall/validation handling stays
  status-and-code-driven.
- No behavior change for clients without `envelope` — the skeleton's demo
  endpoints and `@repo/api-mocks` are untouched.
- The seam is unwrap-only by design: re-wrapping requests is not a thing the
  skeleton has met; if a backend demands request envelopes, that's middleware.

## Sources

- The motivating wire contract: `primat-plus/API_SPECIFICATION.md`
  (`ApiResponse<T>` / `ApiErrorResponse`, v2).
