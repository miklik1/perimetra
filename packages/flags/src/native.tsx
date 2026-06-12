import type { PostHog as PostHogReactNative } from "posthog-react-native";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { FLAGS, type FlagKey, type FlagValue } from "./registry";
import { staticDefaults } from "./static";
import type { Flags } from "./types";

// Native binding (ADR 0028): a `Flags` adapter + React surface over a
// `posthog-react-native` client, the mirror of `./web`. Re-exports the neutral
// contract so the app pulls everything flags from this one entry.
//
// LIVE on mobile (no longer seam-only): posthog-react-native is a pure-JS SDK
// — its only hard deps are `@posthog/core` + `@posthog/types`; every native
// module (expo-file-system, expo-device, async-storage, svg) is an OPTIONAL
// peer. With AsyncStorage supplied as `customStorage` (already a mobile dep)
// and `customAppProperties` passed explicitly, it runs in Expo Go / a dev
// client WITHOUT a native rebuild — so the mobile app constructs the client and
// mounts `FlagsProvider` at boot (apps/mobile/lib/flags.ts + app/_layout.tsx).
// The RN SDK loads flags on init and answers `getFeatureFlag` synchronously
// after, so the adapter is also complete for non-React reads via
// `configureFlags`/`getFlags`.
export * from "./index";

/** Current values for the REGISTRY's keys, falling back to defaults. */
function readClientFlags(client: PostHogReactNative): Record<FlagKey, unknown> {
  const all = staticDefaults();
  for (const key of Object.keys(FLAGS) as FlagKey[]) {
    all[key] = client.getFeatureFlag(key) ?? FLAGS[key].default;
  }
  return all;
}

/**
 * `Flags` over an already-constructed `posthog-react-native` client. Before
 * the SDK's initial flag load, per-key reads return `undefined` and fall back
 * to registry defaults — the same degrade-to-defaults contract as the web
 * adapter. This is what the app installs into the sync carrier
 * (`configureFlags`), so `getFlags()` answers outside React too.
 */
export function createPosthogNativeAdapter(client: PostHogReactNative): Flags {
  return {
    isEnabled: (key) => client.isFeatureEnabled(key) ?? Boolean(FLAGS[key].default),
    getValue: <K extends FlagKey>(key: K) =>
      (client.getFeatureFlag(key) ?? FLAGS[key].default) as FlagValue<K>,
    getAll: (): Record<FlagKey, unknown> => readClientFlags(client),
  };
}

const FlagsContext = createContext<Record<FlagKey, unknown>>(staticDefaults());

export interface NativeFlagsProviderProps {
  /** An already-constructed `posthog-react-native` client (the shared one). */
  client: PostHogReactNative;
  children: ReactNode;
}

/**
 * Native flags provider (ADR 0028), the RN mirror of web's `FlagsProvider`.
 * Unlike web there is no per-request server bootstrap — the RN SDK persists the
 * last-known flags to storage and reloads them on init, so the INITIAL context
 * reads whatever the client already holds (persisted flags or registry
 * defaults), avoiding a flag-flash on warm starts. `onFeatureFlags` then
 * live-updates the context once the network refresh lands and on every
 * `identify`/`reload`. Renders the children directly (no wrapper view); the app
 * mounts PostHog's own autocapture provider separately if it wants screen
 * tracking.
 */
export function FlagsProvider({ client, children }: NativeFlagsProviderProps) {
  const [flags, setFlags] = useState(() => readClientFlags(client));
  useEffect(() => {
    setFlags(readClientFlags(client));
    return client.onFeatureFlags(() => {
      setFlags(readClientFlags(client));
    });
  }, [client]);
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
