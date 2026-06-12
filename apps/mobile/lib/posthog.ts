import AsyncStorage from "@react-native-async-storage/async-storage";
import { PostHog } from "posthog-react-native";

import { env } from "@repo/config/env/mobile";
import { POSTHOG_EU_HOST } from "@repo/flags";

/**
 * The ONE shared PostHog client for mobile (ADR 0028) — the RN analogue of
 * web's `posthog-js` module singleton. A single instance backs BOTH seams:
 * `@repo/flags/native` (feature flags) and `@repo/telemetry`'s analytics
 * adapter (`createPosthogAnalytics`). One SDK, one `identify`, two seams.
 *
 * Built only when `EXPO_PUBLIC_POSTHOG_KEY` is set — absent ⇒ `null`, so the
 * app falls back to registry-default flags + no-op analytics (the same
 * "optional vendor" contract as web and as Sentry on mobile).
 *
 * posthog-react-native is pure JS (no native rebuild): we hand it AsyncStorage
 * as `customStorage` (already a mobile dep) so it never reaches for the
 * optional expo-file-system peer, and `customAppProperties` explicitly so it
 * does not need expo-device/expo-application either. Capturing starts opted
 * OUT (`defaultOptIn: false`) until the parent app signals consent (ADR
 * 0021/0028); flag evaluation runs regardless. `preloadFeatureFlags` is on so
 * flags are fetched at init and `onFeatureFlags` fires for the provider.
 */
function createPosthogClient(): PostHog | null {
  const apiKey = env.EXPO_PUBLIC_POSTHOG_KEY;
  if (!apiKey) return null;
  return new PostHog(apiKey, {
    host: env.EXPO_PUBLIC_POSTHOG_HOST ?? POSTHOG_EU_HOST,
    customStorage: {
      getItem: (key) => AsyncStorage.getItem(key),
      setItem: (key, value) => AsyncStorage.setItem(key, value),
    },
    // Pure-JS app metadata so the SDK never reaches for expo-device /
    // expo-application (both optional peers we do not install).
    customAppProperties: (defaults) => defaults,
    defaultOptIn: false,
    preloadFeatureFlags: true,
    // No app-lifecycle autocapture from the bare client — the provider (if the
    // app mounts PostHog's own provider) owns that. Keeps memory persistence
    // valid and avoids needing app-state native hooks here.
    captureAppLifecycleEvents: false,
  });
}

/**
 * Module singleton: built once per JS runtime at import time. `null` when no
 * PostHog key is configured. Consumed by `lib/flags.ts` (carrier wiring +
 * provider) and `lib/telemetry-boot.ts` (analytics adapter).
 */
export const posthog = createPosthogClient();
