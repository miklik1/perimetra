import type { PostHog as PostHogNode } from "posthog-node";
import { cache } from "react";

import { createLogger } from "@repo/utils";

import { FLAGS, flagsRequiringConsent, type FlagKey, type FlagValue } from "./registry";
import { staticDefaults } from "./static";
import type { FlagsBootstrap } from "./types";

// RSC binding (ADR 0028): per-request server-side evaluation over a
// `posthog-node` client, so the first render is already correct (no flag
// flash). The surface here is ASYNC functions, not the sync `Flags` interface
// — server evaluation is a network call (or local eval with a personal API
// key); the sync interface is the client/static world.
export * from "./index";

const logger = createLogger({ scope: "flags" });

/**
 * Server composition root — its own `globalThis` carrier (the `./create-flags`
 * pattern) holding the ONE `posthog-node` client per server runtime plus the
 * app-injected distinctId getter. Injection keeps the DAG at
 * `flags → {utils, config}`: the cookie/auth read lives in the app, not here.
 */
const SERVER_KEY = Symbol.for("@repo/flags/server-registry");

/**
 * The request's PostHog identity, as the app resolves it (PostHog's own
 * cookie via `readPostHogCookie`, or a freshly minted id on first visit).
 * `isIdentified` mirrors the cookie's `$user_state` — after a client-side
 * `identify`, the cookie's distinct id IS the user id and the bootstrap must
 * say so, or posthog-js would treat it as an anonymous device id.
 */
export interface ServerFlagsIdentity {
  distinctId: string;
  isIdentified: boolean;
}

interface ServerFlagsState {
  client: PostHogNode | null;
  getIdentity: (() => Promise<ServerFlagsIdentity>) | null;
}

const globalRef = globalThis as typeof globalThis & { [SERVER_KEY]?: ServerFlagsState };
const state: ServerFlagsState = (globalRef[SERVER_KEY] ??= { client: null, getIdentity: null });

export interface ServerFlagsConfig {
  /** The per-runtime `posthog-node` client (built in `instrumentation.ts`). */
  client: PostHogNode;
  /** Resolves the request's identity. Called once per request (cached). */
  getIdentity: () => Promise<ServerFlagsIdentity>;
}

/** Install the server evaluation wiring at boot. First configure wins. */
export function configureServerFlags(config: ServerFlagsConfig): void {
  state.client ??= config.client;
  state.getIdentity ??= config.getIdentity;
}

/** Clear the holder (tests only). */
export function resetServerFlags(): void {
  state.client = null;
  state.getIdentity = null;
}

interface RequestEvaluation {
  identity: ServerFlagsIdentity | null;
  featureFlags: Record<string, boolean | string>;
}

/**
 * The single per-request evaluation, deduped with React `cache()` so a layout
 * `getBootstrap()` and any number of page/component `getFlag()` calls share
 * ONE distinctId resolution and ONE PostHog call. Resolving the id inside the
 * same cache entry is deliberate: the app's getter may MINT an id for a first
 * visit, and the id the flags were evaluated for must be the id the client
 * bootstrap adopts — two separate calls could diverge.
 */
const evaluateRequest = cache(async (): Promise<RequestEvaluation> => {
  if (!state.client || !state.getIdentity) {
    return { identity: null, featureFlags: {} };
  }
  const identity = await state.getIdentity();
  try {
    const featureFlags = await state.client.getAllFlags(identity.distinctId);
    return { identity, featureFlags };
  } catch (error) {
    // Evaluation failure (PostHog down, network) ⇒ registry defaults — flags
    // must degrade, never take the page down.
    logger.warn("flag evaluation failed; serving registry defaults", { error });
    return { identity, featureFlags: {} };
  }
});

/** Typed server value of one flag for the current request's user. */
export async function getFlag<K extends FlagKey>(key: K): Promise<FlagValue<K>> {
  const { featureFlags } = await evaluateRequest();
  return (featureFlags[key] ?? FLAGS[key].default) as FlagValue<K>;
}

/** All registry flags as evaluated for the current request (defaults filled). */
export async function getAllFlags(): Promise<Record<FlagKey, unknown>> {
  const { featureFlags } = await evaluateRequest();
  const consentGated = new Set<string>(flagsRequiringConsent());
  const all = staticDefaults();
  for (const key of Object.keys(FLAGS) as FlagKey[]) {
    // Consent gate (ADR 0036): a requiresConsent flag keeps its registry
    // default; its evaluated (possibly personalized) value is withheld so it
    // can't be serialized to the client before analytics consent is granted.
    if (!consentGated.has(key) && key in featureFlags) all[key] = featureFlags[key];
  }
  return all;
}

/**
 * The client seed (ADR 0028 "no flag flash"): the request's distinct id + its
 * evaluated flags, for `FlagsProvider`'s `bootstrap` prop → `posthog.init`.
 * `undefined` when server flags aren't configured (no key) — the provider
 * then renders registry defaults and skips bootstrap.
 */
export async function getBootstrap(): Promise<FlagsBootstrap | undefined> {
  const { identity, featureFlags } = await evaluateRequest();
  if (identity === null) return undefined;
  // Consent gate (ADR 0036): drop requiresConsent flags before serializing into
  // SSR HTML — the client gate prevents their USE, but only this prevents their
  // TRANSMISSION pre-consent. Non-registry keys PostHog returns pass through
  // (the Set only holds registry keys flagged consent-gated).
  const consentGated = new Set<string>(flagsRequiringConsent());
  const safeFlags = Object.fromEntries(
    Object.entries(featureFlags).filter(([key]) => !consentGated.has(key)),
  );
  return {
    distinctID: identity.distinctId,
    isIdentifiedID: identity.isIdentified,
    featureFlags: safeFlags,
  };
}
