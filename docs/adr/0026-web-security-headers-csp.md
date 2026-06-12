# ADR 0026 — Web security headers + CSP (standalone deploy, nonce-based)

**Status:** Accepted (2026-06-04).

## Context

The web app ships no security headers or Content-Security-Policy. For a
production base that backs real products this is a gap (clickjacking, MIME
sniffing, mixed content, XSS surface). Two app-specific constraints shape the
design:

1. **Standalone deploy.** The app runs on its own origin, **not** iframed by the
   parent app — so framing can be locked down (`frame-ancestors 'self'`).
2. **An inline script exists.** `apps/web/app/layout.tsx` injects the no-FOUC
   theme `<script>` before first paint (ADR 0004/0010). A strict CSP without
   `unsafe-inline` will block it unless it carries a **nonce** or hash.

## Decision

**Add a baseline security-header set and a nonce-based CSP to the web app.**

- **Headers** (via `next.config.js` `headers()` for the static set):
  - `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `X-Frame-Options: DENY` (standalone; belt-and-suspenders with CSP)
  - `Permissions-Policy` — deny camera/microphone/geolocation by default.
- **CSP** generated per-request in `apps/web/proxy.ts` (Next middleware) with a
  fresh **nonce**: `default-src 'self'`; `script-src 'self' 'nonce-<n>'`;
  `style-src 'self' 'unsafe-inline'` (Tailwind/Next inject styles);
  `img-src 'self' data: blob:`; `connect-src 'self'` (+ the Sentry ingest origin
  from env when telemetry is on); `frame-ancestors 'self'`; `base-uri 'self'`;
  `form-action 'self'`; `object-src 'none'`. The nonce is passed to the layout's
  inline theme script (Next exposes the middleware nonce to the document), so the
  no-FOUC script keeps working under a strict policy — **no `unsafe-inline` for
  scripts.**
- **Connect-src is env-aware:** when `NEXT_PUBLIC_SENTRY_DSN` is set, its origin
  is appended to `connect-src` (and `report-uri`/`report-to` may point at Sentry)
  so telemetry (ADR 0021) isn't blocked. Dev relaxes CSP as needed (HMR/websocket).
- **`frame-ancestors` is parameterized** behind a config value defaulting to
  `'self'`, so if the app is ever embedded later, allowing the parent origin is a
  config change, not a rewrite.

## Consequences

- Standard hardening (clickjacking, sniffing, transport, XSS surface) with a
  strict, nonce-based `script-src` — and the inline theme script still runs.
- CSP is computed in middleware (`proxy.ts`), which already runs for the auth
  gate, so there is one request-time hook to own both. Dynamic nonce means the
  document is not statically cacheable on routes that emit it — acceptable, and
  scoped to HTML responses.
- A new tradeoff to maintain: any future inline script/style or third-party
  origin must be added to the CSP (or given a nonce), or it will be blocked —
  intentional, the point of CSP.
- Sentry/telemetry origins must be reflected in `connect-src`, tying ADR 0021's
  env to the policy.

## Sources

- MDN — Content-Security-Policy, `frame-ancestors`, nonces:
  <https://developer.mozilla.org/docs/Web/HTTP/CSP> (verified 2026-06-04).
- Next.js — CSP with nonces via middleware:
  <https://nextjs.org/docs/app/guides/content-security-policy> (verified 2026-06-04).
- [ADR 0004](0004-theming-token-system.md)/[ADR 0010](0010-ui-state-zustand-store-package.md)
  (the inline no-FOUC script that needs a nonce),
  [ADR 0017](0017-auth-client-hardening.md) (the `proxy.ts` middleware this
  extends), [ADR 0021](0021-telemetry-observability-package.md) (Sentry origin in
  `connect-src`).
