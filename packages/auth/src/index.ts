// Server-safe barrel (`@repo/auth`). A thin Better Auth client wrapper; the
// React surface (provider, hooks, guard) lives behind the `"use client"`
// boundary in `./react` (`@repo/auth/react`) and is intentionally NOT
// re-exported here (mirrors `@repo/api`). The ADR 0016/0017 token-manager /
// refresh-middleware machinery is superseded by cookie sessions (design
// §7.1/§9): the browser carries an httpOnly session cookie through the
// same-origin proxy, and the API service owns refresh.

export { createAuthClient } from "./client";
export type { AuthClient, AuthClientOptions } from "./client";

// Optimistic session-cookie PRESENCE check for the request-time gate
// (apps/web/proxy.ts). Explicitly NOT validation — the docs warn it must never
// authorize anything; the API service stays the authority.
export { getSessionCookie } from "better-auth/cookies";
