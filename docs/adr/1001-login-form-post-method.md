# ADR 1001 — Submit the login form over POST, not the browser's GET default

**Status:** Accepted (2026-07-09).

## Context

The login form (`apps/web/app/login/login-form.tsx`) relies entirely on a React `onSubmit` handler — wired through `useZodForm`'s `handleSubmit`, which calls `event.preventDefault()` before invoking the mutation. The `<form>` element itself carried no `method` attribute. (This skeleton's login submits through the Better Auth client — `authClient.signIn.email` — rather than web-native-skeleton's token flow, but the pre-hydration exposure is identical: it is a property of the raw `<form>`, not of the handler.)

An HTML form with no `method` attribute defaults to GET. The `onSubmit` handler only exists once the client component has hydrated. Before that point — a slow bundle download, a fast typist, a user who hits Enter in the password field the instant the markup paints, or a flaky network delaying hydration — a form submit falls back to the browser's native, unhandled submission path, which uses that default GET method.

A native GET submission serialises every field, including the plaintext password, into the query string of the request URL. The exposure does not stop at the single request: the URL is written into browser history, retransmitted in the `Referer` header on every subsequent navigation from that page, and recorded verbatim in the access logs of every proxy, CDN, and origin server the request passes through. This is an application/URL-layer leak, orthogonal to and not mitigated by transport security (HTTPS protects the wire, not the URL's own persistence and propagation).

## Decision

Set `method="post"` explicitly on the login form element. This changes only the native/unhydrated fallback path — the common, hydrated path is functionally unchanged, because `onSubmit`'s `preventDefault()` still intercepts every submit once the island is live, so no browser navigation happens either way.

Add a regression test that asserts the rendered `method` attribute on the form directly (not the presence or behaviour of the `onSubmit` handler), because the handler is exactly the mechanism that is absent in the pre-hydration window this fix protects — a test that only exercises `onSubmit` would pass even if `method` regressed back to unset/GET.

Treat this as a form-level class fix: every credential-bearing form in this codebase and every project derived from this skeleton (register, password reset, any mutation carrying a secret) should carry the same `method="post"`, not just login.

## Consequences

- Closes a credential-leak vector that exists independent of TLS, requires no client-side JavaScript to protect, and costs a single HTML attribute per form.
- The added test pins the actual protected surface (the rendered `method` attribute) rather than the handler, so it will not silently regress if the handler wiring is refactored without touching this attribute.
- No behavioural change to the hydrated (JS-enabled) flow, which is the overwhelming majority of real user sessions — `handleSubmit`'s `preventDefault()` continues to own the submit path there.
- Open follow-up (not yet decided or built): whether to add a lint rule enforcing `method="post"` on any `<form>` containing a `type="password"` input, so future forms don't rely on someone remembering this ADR by hand.

## Sources

- Ported from web-native-skeleton commit `2a517e5` ("fix(auth): submit the login form over POST so a pre-hydration submit cannot leak the password"); landed in this skeleton against its Better Auth client login form.
