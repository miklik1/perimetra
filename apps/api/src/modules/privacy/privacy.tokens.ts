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

export interface PrivacyHandler {
  /** Key the handler's export lands under in the export JSON ("project", …). */
  readonly entityType: string;
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
