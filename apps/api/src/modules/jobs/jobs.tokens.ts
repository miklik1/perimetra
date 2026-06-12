/**
 * Queue names + DI tokens (own file — same cycle-avoidance rule as
 * `auth.tokens.ts`).
 *
 * Queue registry (ADR 0043): every queue is declared HERE so the worker, the
 * bull-board mount, and producers share one source of truth.
 */
export const QUEUES = {
  /** Domain events relayed from the outbox (ADR 0037). */
  events: "events",
  /** Dead-letter queue — exhausted jobs land here with origin metadata. */
  dlq: "dlq",
  /** Repeatable housekeeping (outbox cleanup, retention jobs, …). */
  maintenance: "maintenance",
  /** GDPR export/erasure fan-out + audit retention (spec §7.7, ADR 0040). */
  privacy: "privacy",
} as const;

/** Multi-provider token: domain modules register event handlers under it. */
export const DOMAIN_EVENT_HANDLERS = Symbol("DOMAIN_EVENT_HANDLERS");

export interface DomainEventHandler {
  /** Outbox `eventType`s this handler consumes. */
  readonly eventTypes: readonly string[];
  handle(event: {
    eventType: string;
    aggregateType: string;
    aggregateId: string;
    payload: Record<string, unknown>;
  }): Promise<void>;
}
