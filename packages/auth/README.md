# @repo/auth

Better Auth client wrapper (design §7.1/§9). Sessions are httpOnly cookies
minted and refreshed by the API service; the browser reaches it same-origin
through the Next.js rewrite proxy (`/api/auth/*`), so this package holds no
token, no JWT decoding, and no refresh middleware — those ADR 0016/0017
mechanisms are superseded.

## Exports

Server-safe barrel (`@repo/auth`):

- `createAuthClient` (`AuthClientOptions`, `AuthClient`) — the app's Better
  Auth client factory (admin client plugin on; api-key plugin off by policy).
  Omit `baseURL` on web (same-origin proxy); pass the API origin on native.
- `getSessionCookie` — re-export of `better-auth/cookies` for the optimistic
  cookie-presence gate in `apps/web/proxy.ts` (NOT validation).

Client-only surface (`@repo/auth/react`, `"use client"`):

- `AuthProvider` (`AuthProviderProps`) — owns the client for the subtree
  (build-once-per-mount, like `ApiProvider`). Accepts a pre-built `client` for
  platforms with extra plugins (Expo SecureStore).
- `useAuth` (`UseAuthResult`) — identity surface over `useSession`:
  `user` (normalized to `@repo/validators`' `User`), `isAuthenticated`,
  `sessionValidated`, `logout()` (server revoke + query-cache clear),
  `refetch()`.
- `useAuthClient` — the full Better Auth client (sign-in/sign-up/admin flows).
- `AuthGuard` (`AuthGuardProps`) — router-agnostic route gate.

## Usage

```tsx
import { ApiProvider } from "@repo/api/react";
import { AuthProvider, useAuthClient } from "@repo/auth/react";

// providers (web: no baseUrl — the rewrite proxy makes auth same-origin)
<ApiProvider baseUrl="/api">
  <AuthProvider>{children}</AuthProvider>
</ApiProvider>;

// login form
const authClient = useAuthClient();
const { error } = await authClient.signIn.email({ email, password });
```

The cross-tab/proactive-refresh effects (SessionMonitor, AuthBridge) are gone:
cookie sessions are refreshed server-side and shared between tabs by the
browser's cookie jar.

## Decisions

- Design §7.1 — Better Auth on the API service; this package is the client
  wrapper with the public surface (`useAuth`, `AuthGuard`, provider) preserved.
- Supersedes [ADR 0016](../../docs/adr/0016-auth-jwt-refresh-package.md) and
  [ADR 0017](../../docs/adr/0017-auth-client-hardening.md) client machinery
  (token manager, refresh middleware, storage adapters) — ADR 0033 to follow.
- [ADR 0012](../../docs/adr/0012-api-client-factory.md) — provider builds its
  client once per mount; no module-global state.
