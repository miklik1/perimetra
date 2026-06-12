import { configureFlags } from "@repo/flags";
import { createPosthogNativeAdapter } from "@repo/flags/native";

import { posthog } from "./posthog";

/**
 * Flags boot (ADR 0028) — the mobile mirror of web's `bootFlags`, called once
 * at module scope from `app/_layout.tsx`. Where web's `bootFlags` is
 * intentionally empty (web reads flags via the RSC bootstrap + `FlagsContext`,
 * never the sync carrier), MOBILE is the first real consumer of the carrier:
 * it installs the `posthog-react-native` adapter into `configureFlags`, so
 * `getFlags()` answers outside React (e.g. in shared modules) and the
 * `FlagsProvider` hooks (`useFlag`/`useFlagValue`) read the same client.
 *
 * No PostHog key ⇒ `posthog` is `null` ⇒ we skip configure and the carrier
 * stays on registry defaults (the static adapter) — dev/test run with defaults,
 * matching web. Idempotent: `configureFlags` is first-wins.
 */
export function bootFlags(): void {
  if (posthog) {
    configureFlags(createPosthogNativeAdapter(posthog));
  }
}
