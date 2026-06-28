/**
 * Privacy DI tokens + contracts (spec §7.7, ADR 0040) — own file, same
 * cycle-avoidance rule as `auth.tokens.ts` / `jobs.tokens.ts`.
 *
 * The GDPR fan-out: each domain module that stores user data registers a
 * `PrivacyHandler` under the `PRIVACY_HANDLERS` multi-provider (the
 * `DOMAIN_EVENT_HANDLERS` pattern); the worker-side `PrivacyProcessor` fans
 * export (Art. 20) and erasure (Art. 17) jobs out across all of them, then
 * runs the built-in core erasures (Better Auth row anonymization, session +
 * account deletion) and the third-party purge hooks.
 */

/** Multi-provider token: domain modules register `PrivacyHandler[]` under it. */
export const PRIVACY_HANDLERS = Symbol("PRIVACY_HANDLERS");

/**
 * GDPR data-category of an exported entity. `"special-category"` marks Art. 9
 * data (health / biometric / …) so the export DOCUMENT identifies it instead of
 * being basis-blind. FACTUAL classification only, driven by the schema's own
 * designation — the specific Art. 9(2) lawful-basis CONDITION and whether
 * export/erasure should be basis-FILTERED remain a documented legal decision per
 * derived project, NOT asserted here. The skeleton ships only the ordinary
 * reference handler; escalating one is a per-module legal call.
 *
 * Module-local: handlers set the field with the string literal (structurally
 * checked against {@link PrivacyHandler.dataCategory}), so nothing imports this
 * name yet. A module that escalates and wants the type can re-export it.
 */
type DataCategory = "ordinary" | "special-category";

export interface PrivacyHandler {
  /** Key the handler's export lands under in the export JSON ("project", …). */
  readonly entityType: string;
  /**
   * GDPR data-category of this handler's entity. Absent ⇒ `"ordinary"`. Set
   * `"special-category"` only where the schema designates Art. 9 data, so the
   * export marks it (see {@link DataCategory}).
   */
  readonly dataCategory?: DataCategory;
  /** Everything this module stores about the user (Art. 20 portability). */
  exportUser(userId: string): Promise<Record<string, unknown>>;
  /** Delete or anonymize it (Art. 17). MUST be idempotent — jobs retry. */
  eraseUser(userId: string): Promise<void>;
}

/**
 * Multi-provider token for third-party purge hooks (Sentry user scrubbing,
 * PostHog person-profile deletion, Centrifugo history…). The bound hooks
 * (purge/) each no-op with a log when their env keys are absent.
 */
export const PURGE_HOOKS = Symbol("PURGE_HOOKS");

export interface PurgeHook {
  readonly name: string;
  /** Purge the user from the third-party system. Idempotent — jobs retry. */
  purgeUser(userId: string): Promise<void>;
}

/** Job names on the `privacy` queue — shared by producer and processor. */
export const PRIVACY_JOBS = {
  export: "privacy-export",
  erase: "privacy-erase",
  /** Scheduled (not user-triggered): the 2-year audit retention sweep. */
  auditCleanup: "audit-cleanup",
} as const;
