import { useEffect, useRef } from "react";

import { useAuth } from "@repo/auth/react";
import { getTelemetry } from "@repo/telemetry";

/**
 * Analytics/telemetry identity bridge (ADR 0021/0028), the mobile mirror of
 * web's `app/analytics-identity.tsx` — the ONE place the auth user is wired
 * into the analytics seam (renders nothing). On login: `analytics.identify`
 * (PostHog merges the anonymous device id into the user and re-fetches flags
 * for it — the native `FlagsProvider`'s `onFeatureFlags` subscription picks the
 * targeted values up) and `setUser` (capture, a no-op until the native Sentry
 * seam is wired). On logout: `analytics.reset` + `setUser(null)`.
 *
 * The logout branch only fires on an actual authed→signed-out TRANSITION —
 * never on the initial anonymous mount — so it never mints a fresh PostHog
 * device id on a cold start. `User` carries `name`, not `username` — mapped
 * name → username here, the single mapping site.
 */
export function AnalyticsIdentity() {
  const { user } = useAuth();
  const hadUserRef = useRef(false);

  useEffect(() => {
    const telemetry = getTelemetry();
    if (user) {
      hadUserRef.current = true;
      const identity = { id: user.id, email: user.email, username: user.name };
      telemetry.analytics.identify(identity);
      telemetry.setUser(identity);
    } else if (hadUserRef.current) {
      hadUserRef.current = false;
      telemetry.analytics.reset();
      telemetry.setUser(null);
    }
  }, [user]);

  return null;
}
