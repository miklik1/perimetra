"use client";

import type { PostHog } from "posthog-js";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { POSTHOG_EU_HOST } from "./posthog";
import { FLAGS, type FlagKey, type FlagValue } from "./registry";
import { staticDefaults } from "./static";
import type { Flags, FlagsBootstrap } from "./types";

// Web client binding (ADR 0028): a thin `Flags` adapter + React surface over
// the `posthog-js` module singleton. Re-exports the neutral contract so the
// app pulls everything flags from this one entry, the mirror of `./native`.
export * from "./index";

/** Current values for the REGISTRY's keys, falling back to defaults. */
function readClientFlags(client: PostHog): Record<FlagKey, unknown> {
  const all = staticDefaults();
  for (const key of Object.keys(FLAGS) as FlagKey[]) {
    all[key] = client.getFeatureFlag(key) ?? FLAGS[key].default;
  }
  return all;
}

/**
 * `Flags` over the shared `posthog-js` singleton. Safe to construct (and
 * `configureFlags`) BEFORE `posthog.init` runs — every method guards on the
 * SDK's `__loaded` and serves registry defaults until then, so the carrier
 * configuration in `instrumentation-client.ts` never races the provider's
 * init (which waits for the server bootstrap props).
 */
export function createPosthogClientAdapter(client: PostHog): Flags {
  return {
    isEnabled: (key) =>
      client.__loaded
        ? (client.isFeatureEnabled(key) ?? Boolean(FLAGS[key].default))
        : Boolean(FLAGS[key].default),
    getValue: <K extends FlagKey>(key: K) =>
      (client.__loaded
        ? ((client.getFeatureFlag(key) ?? FLAGS[key].default) as FlagValue<K>)
        : FLAGS[key].default) as FlagValue<K>,
    getAll: (): Record<FlagKey, unknown> =>
      client.__loaded ? readClientFlags(client) : staticDefaults(),
  };
}

/** Registry defaults overlaid with the server-evaluated bootstrap values. */
function mergeBootstrap(bootstrap?: FlagsBootstrap): Record<FlagKey, unknown> {
  const merged = staticDefaults();
  if (bootstrap) {
    for (const key of Object.keys(FLAGS) as FlagKey[]) {
      if (key in bootstrap.featureFlags) merged[key] = bootstrap.featureFlags[key];
    }
  }
  return merged;
}

const FlagsContext = createContext<Record<FlagKey, unknown>>(staticDefaults());

export interface FlagsProviderProps {
  /** The `posthog-js` module singleton (`import posthog from "posthog-js"`). */
  client: PostHog;
  /** Server-evaluated seed from `getBootstrap()` (`./web/server`). */
  bootstrap?: FlagsBootstrap;
  /** `NEXT_PUBLIC_POSTHOG_KEY` — absent ⇒ no init, registry/bootstrap values only. */
  apiKey?: string;
  /** `NEXT_PUBLIC_POSTHOG_HOST` — defaults to the EU cloud. */
  host?: string;
  /**
   * PII scrub for analytics event PROPERTIES, injected from the app's
   * composition root (`@repo/telemetry`'s `sanitizeAnalyticsProperties`; the DAG
   * forbids a `flags → telemetry` import). Wired into posthog's `before_send`,
   * so it covers SDK-autocaptured events — `$pageview`'s `$current_url` query —
   * that never pass through the telemetry analytics adapter. Absent ⇒ no scrub.
   */
  sanitizeProperties?: (properties: Record<string, unknown>) => Record<string, unknown>;
  children: ReactNode;
}

/**
 * Client flags provider (ADR 0028). The context value drives `useFlag` /
 * `useFlagValue`; its INITIAL state merges the server-evaluated bootstrap over
 * registry defaults, so SSR HTML and the first client render agree — no flag
 * flash, no hydration mismatch.
 *
 * `posthog.init` runs HERE (not in `instrumentation-client.ts`) because the
 * `bootstrap` option needs this request's server evaluation, which only the
 * render tree can deliver — PostHog's documented App Router pattern. The
 * `__loaded` guard makes it once-per-browser-runtime and idempotent under
 * StrictMode/HMR. Capturing starts opted OUT (`opt_out_capturing_by_default`)
 * until the parent app signals consent (ADR 0021/0028); flag evaluation works
 * regardless. After init, `onFeatureFlags` live-updates the context.
 */
export function FlagsProvider({
  client,
  bootstrap,
  apiKey,
  host,
  sanitizeProperties,
  children,
}: FlagsProviderProps) {
  const [flags, setFlags] = useState(() => mergeBootstrap(bootstrap));
  useEffect(() => {
    if (apiKey && !client.__loaded) {
      client.init(apiKey, {
        api_host: host ?? POSTHOG_EU_HOST,
        // Sane-defaults snapshot (the SDK's versioned option bundle); the
        // newest date shipped with the pinned posthog-js line.
        defaults: "2026-05-30",
        opt_out_capturing_by_default: true,
        // PII scrub over EVERY event's properties — including the SDK's own
        // autocaptured `$pageview` ($current_url query), which the telemetry
        // analytics adapter never sees. `sanitize_properties` is deprecated in
        // favour of `before_send`; scrub `properties`, `$set`, `$set_once`.
        before_send: sanitizeProperties
          ? (event) => {
              if (!event) return event;
              // Session-replay batches ride the same capture path, but their
              // `$snapshot_data` is a serialized rrweb DOM — walking it would
              // rewrite node `href`/`src` attributes (breaking replay: a
              // `/_next/image?url=…&w=640` becomes a 400), desync
              // `$snapshot_bytes` from the payload, and deep-copy up to ~1 MB
              // synchronously per batch. Replay masking is rrweb's own layer
              // (`maskAllInputs`/privacy classes) — this is the wrong seam.
              if (event.event === "$snapshot") return event;
              event.properties = sanitizeProperties(event.properties);
              if (event.$set) event.$set = sanitizeProperties(event.$set);
              if (event.$set_once) event.$set_once = sanitizeProperties(event.$set_once);
              return event;
            }
          : undefined,
        bootstrap: bootstrap && {
          distinctID: bootstrap.distinctID,
          isIdentifiedID: bootstrap.isIdentifiedID,
          featureFlags: bootstrap.featureFlags,
        },
      });
    }
    return client.onFeatureFlags(() => {
      setFlags(readClientFlags(client));
    });
  }, [client, bootstrap, apiKey, host, sanitizeProperties]);
  return <FlagsContext value={flags}>{children}</FlagsContext>;
}

/** Boolean state of a flag (variants coerce: any non-empty variant ⇒ true). */
export function useFlag(key: FlagKey): boolean {
  return Boolean(useContext(FlagsContext)[key]);
}

/** Typed value of a flag (variant union / boolean, from the registry). */
export function useFlagValue<K extends FlagKey>(key: K): FlagValue<K> {
  return (useContext(FlagsContext)[key] ?? FLAGS[key].default) as FlagValue<K>;
}
