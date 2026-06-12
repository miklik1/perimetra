"use client";

import { useEffect, useRef } from "react";

import { useAuth } from "@repo/auth/react";
import { getTelemetry } from "@repo/telemetry";

/**
 * Analytics/telemetry identity bridge (ADR 0021/0028) — the ONE place the
 * auth user is wired into both seams (a render-nothing effect component). On login: `analytics.identify` (PostHog merges the
 * anonymous device id into the user and re-fetches flags for it — the
 * FlagsProvider's `onFeatureFlags` subscription picks the targeted values up)
 * and Sentry `setUser`. On logout: `analytics.reset` (drops the PostHog
 * identity + device id) and `setUser(null)`.
 *
 * The logout branch only fires on an actual authed→signed-out TRANSITION —
 * never on the initial anonymous mount. Resetting there would mint a fresh
 * PostHog device id on every page load, breaking the server-evaluation cookie
 * continuity (ADR 0028 bootstrap).
 *
 * `User` carries `name`, not `username` — mapped name → username here, the
 * single mapping site for both seams.
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
