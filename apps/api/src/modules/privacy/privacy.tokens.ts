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
  /**
   * Optional SECOND pass, run once AFTER every handler's `eraseUser` has
   * completed — so the whole fan-out, including cross-module deletes another
   * handler owns, is already applied. A handler uses it to repair a
   * cross-cutting invariant that its own per-subject `eraseUser` cannot express,
   * because by loop-end the subject linkage is gone (ADR 1010, ports anyora ADR
   * 0067's defunct-grant closure). MUST be idempotent — jobs retry. Absent ⇒ no
   * finalize step for that handler. The reference `ProjectsPrivacyHandler` needs
   * no such repair; the seam is merely available.
   */
  finalizeErasure?(userId: string): Promise<void>;
}

/**
 * Multi-provider token for third-party purge hooks (Sentry user scrubbing,
 * PostHog person-profile deletion, Centrifugo history…). The bound hooks
 * (purge/) each skip (with a log) when their env keys are absent.
 */
export const PURGE_HOOKS = Symbol("PURGE_HOOKS");

/**
 * The result of a {@link PurgeHook.purgeUser} (ADR 1010, ports anyora ADR 0068).
 * A third party either PURGED the user (deleted, or the PII-free end-state
 * already held), has no per-user deletion API so the obligation is DOCUMENTED
 * (its data is minimized at source instead), or was unconfigured and SKIPPED.
 * There is deliberately NO "failed" variant — a HARD failure THROWS rather than
 * returning, so the job fails → retries → DLQs (the ban-purge escalation shape,
 * anyora ADR 0056); a purge failure is never a swallowed return. `detail` is a
 * non-PII string. The processor records these in the erasure read-model (the
 * `privacy.erase` audit diff + the BullMQ `job.returnvalue`), so a purge is an
 * accounted-for step, not a hope in a log — and a `documented`/`skipped` outcome
 * NEVER downgrades erasure success.
 */
export type PurgeOutcome = {
  readonly status: "purged" | "documented" | "skipped";
  readonly detail?: string;
};

export interface PurgeHook {
  readonly name: string;
  /**
   * Purge the user from the third-party system. Idempotent — jobs retry.
   * Returns a {@link PurgeOutcome} recorded in the erasure read-model; a HARD
   * failure THROWS (escalates) instead of returning.
   */
  purgeUser(userId: string): Promise<PurgeOutcome>;
}

/** Job names on the `privacy` queue — shared by producer and processor. */
export const PRIVACY_JOBS = {
  export: "privacy-export",
  erase: "privacy-erase",
  /** Scheduled (not user-triggered): the 2-year audit retention sweep. */
  auditCleanup: "audit-cleanup",
} as const;
