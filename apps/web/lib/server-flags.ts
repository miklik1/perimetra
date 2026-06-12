import { cookies } from "next/headers";
import { PostHog, readPostHogCookie } from "posthog-node";

import { env } from "@repo/config/env/web";
import { POSTHOG_EU_HOST } from "@repo/flags";
import { configureServerFlags, type ServerFlagsIdentity } from "@repo/flags/web/server";

/**
 * Resolve the request's PostHog identity for server-side flag evaluation
 * (ADR 0028). The id comes from PostHog's OWN cookie (`ph_<key>_posthog`,
 * read with the SDK's `readPostHogCookie`) — after a client-side `identify`
 * the cookie carries the user id and `isIdentified`, so authed users get
 * their targeted flags with no extra auth plumbing. First visit (no cookie):
 * mint an id here; `getBootstrap()` hands it to `posthog.init` as
 * `bootstrap.distinctID`, the client adopts it, and the very first render is
 * already evaluated for the same id — full no-flash. The `@repo/flags`
 * server carrier caches this per request, so layout + page share one call.
 */
async function getServerFlagsIdentity(): Promise<ServerFlagsIdentity> {
  // Non-null: only called once configured, which requires the key (below).
  const apiKey = env.NEXT_PUBLIC_POSTHOG_KEY ?? "";
  const state = readPostHogCookie(await cookies(), apiKey);
  if (state) return { distinctId: state.distinctId, isIdentified: state.isIdentified };
  return { distinctId: crypto.randomUUID(), isIdentified: false };
}

/**
 * Server flags boot (ADR 0028) — called once per NODE server runtime from
 * `instrumentation.ts` (`register()`); the browser half is `flags-boot.ts`.
 * Builds the ONE per-runtime `posthog-node` client and injects it + the
 * identity getter into the `@repo/flags` server carrier. No key ⇒ no client,
 * `getFlag`/`getAllFlags` serve registry defaults and `getBootstrap()` is
 * undefined — and crucially no `cookies()` call, so key-less pages keep
 * static rendering. With `POSTHOG_PERSONAL_API_KEY` the client evaluates
 * flags locally (no per-request PostHog call) — the ADR's documented tuning.
 */
export function bootServerFlags(): void {
  if (!env.NEXT_PUBLIC_POSTHOG_KEY) return;
  const client = new PostHog(env.NEXT_PUBLIC_POSTHOG_KEY, {
    host: env.NEXT_PUBLIC_POSTHOG_HOST ?? POSTHOG_EU_HOST,
    personalApiKey: env.POSTHOG_PERSONAL_API_KEY,
  });
  configureServerFlags({ client, getIdentity: getServerFlagsIdentity });
}
