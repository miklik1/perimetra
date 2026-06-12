/**
 * Server-side PostHog (ADR 0036, amends 0028): events the client can't be
 * trusted with (domain events, job outcomes) and server-side flag evaluation
 * over the SAME typed registry the frontend uses (`@repo/flags/server`).
 * Fail-soft everywhere: without POSTHOG_API_KEY every method is a no-op —
 * analytics must never break a business operation.
 */
import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { PostHog } from "posthog-node";

import { FLAGS, type FlagKey, type FlagValue } from "@repo/flags/server";

import { POSTHOG } from "./analytics.tokens.js";

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(@Optional() @Inject(POSTHOG) private readonly client: PostHog | null) {}

  /** distinctId = our user id (the ADR 0028 identity bridge). */
  capture(distinctId: string, event: string, properties?: Record<string, unknown>): void {
    if (!this.client) return;
    try {
      this.client.capture({ distinctId, event, ...(properties ? { properties } : {}) });
    } catch (error) {
      this.logger.error(
        `capture failed for ${event}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /** Boolean convenience over {@link getFlag}. */
  async isEnabled(key: FlagKey, distinctId: string): Promise<boolean> {
    return Boolean(await this.getFlag(key, distinctId));
  }

  /**
   * One flag for one user, falling back to the registry default (the same
   * "off is defined once" rule as the frontend adapters, ADR 0028).
   * posthog-node v5's snapshot API is preferred; older clients fall back to
   * the stable per-flag call — both feature-detected, both fail-soft.
   */
  async getFlag<K extends FlagKey>(key: K, distinctId: string): Promise<FlagValue<K>> {
    const fallback = FLAGS[key].default as FlagValue<K>;
    if (!this.client) return fallback;
    try {
      const candidate = this.client as unknown as {
        evaluateFlags?: (input: { distinctId: string; flagKeys?: string[] }) => Promise<{
          flags?: Record<string, { value?: unknown; enabled?: boolean; variant?: string }>;
        }>;
        getFeatureFlag: (key: string, distinctId: string) => Promise<unknown>;
      };
      if (typeof candidate.evaluateFlags === "function") {
        const snapshot = await candidate.evaluateFlags({ distinctId, flagKeys: [key] });
        const flag = snapshot.flags?.[key];
        if (flag === undefined) return fallback;
        const value = flag.value ?? flag.variant ?? flag.enabled;
        return (value === undefined ? fallback : value) as FlagValue<K>;
      }
      const value = await candidate.getFeatureFlag(key, distinctId);
      return (value === undefined || value === null ? fallback : value) as FlagValue<K>;
    } catch (error) {
      this.logger.error(
        `flag ${key} evaluation failed`,
        error instanceof Error ? error.stack : undefined,
      );
      return fallback;
    }
  }
}
