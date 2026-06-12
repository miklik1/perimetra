# analytics — server-side PostHog (ADR 0036)

`posthog-node` for the events the client can't be trusted with (domain
events, job outcomes) and server-side flag evaluation. **No-op when
`POSTHOG_API_KEY` is unset** — every call site may assume the service exists.
EU Cloud is the default host. Sentry / PostHog / OTel stay three
non-overlapping layers: what broke / what users do / why it's slow.

## Public surface

- `AnalyticsService.capture(...)` — server-side event capture with a property
  allowlist (no free-form PII properties; person profiles are what the
  privacy purge hook deletes).
- `AnalyticsService.isEnabled(key, distinctId)` / `.getFlag(key, distinctId)`
  — typed against the shared `@repo/flags` registry (one registry across
  React, RSC, NestJS, workers); local evaluation when
  `POSTHOG_PERSONAL_API_KEY` is set.
- `POSTHOG` DI token (`analytics.tokens.ts`) — the raw client, for the
  privacy purge hook only.

## Must never

- Gate critical paths on flag-evaluation network calls — defaults must be
  safe when PostHog is down or disabled.
- Capture PII properties or invent flag keys outside `@repo/flags`.
- Import domain module schemas.

Governing ADR: `docs/adr/0036-backend-observability.md`.
