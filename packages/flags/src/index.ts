/**
 * Neutral barrel for `@repo/flags` (ADR 0028) — the typed registry, the
 * vendor-agnostic contract, the static-default adapter and the composition
 * root. NO `posthog-*` import on this path: apps and tests can depend on it
 * without pulling an SDK; the bindings live behind `@repo/flags/web`,
 * `@repo/flags/web/server` and `@repo/flags/native`.
 */
export { FLAGS, type FlagKey, type FlagValue } from "./registry";

export type { Flags, FlagsBootstrap } from "./types";

export { createStaticFlags, staticDefaults } from "./static";

export { configureFlags, getFlags, resetFlags } from "./create-flags";

export { POSTHOG_EU_HOST } from "./posthog";
