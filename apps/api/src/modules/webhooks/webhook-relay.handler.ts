/**
 * The bridge from domain events to outbound webhooks: a factory producing a
 * `DomainEventHandler` (the same multi-provider shape every module registers
 * under `DOMAIN_EVENT_HANDLERS`, ADR 0043) that fans an event out to webhook
 * endpoints.
 *
 * The skeleton does NOT bind it — endpoint configuration (which URLs, which
 * secrets, which event types) is project-owned state this seam refuses to
 * guess at (env-var pairs for one consumer, a registry table for many — see
 * README.md). A project binds it the same way every domain handler reaches
 * the events processor: provide it under a token in a worker module,
 *
 * ```ts
 * {
 *   provide: WEBHOOK_RELAY_HANDLER, // project-defined token
 *   inject: [WebhookDispatcher, WebhookEndpointsRepository],
 *   useFactory: (dispatcher, endpoints) =>
 *     createWebhookRelayHandler(dispatcher, {
 *       eventTypes: [PROJECT_CREATED, PROJECT_ARCHIVED],
 *       endpointsFor: (event) => endpoints.subscribedTo(event.eventType),
 *     }),
 * }
 * ```
 *
 * then append the token to `OutboxWorkerModule`'s `DOMAIN_EVENT_HANDLERS`
 * aggregation (the `@gen:domain-event-handlers` inject anchor) — Nest has no
 * true multi-provider, that factory owns the one array (ADR 0043).
 */
import { type DomainEventHandler } from "../jobs/jobs.tokens.js";
import { type WebhookDispatcher } from "./webhook-dispatcher.service.js";

/** One delivery target. Where these live (env, table) is project-owned. */
export interface WebhookEndpointTarget {
  url: string;
  /** Per-endpoint signing secret — never shared across endpoints. */
  secret: string;
}

type RelayedDomainEvent = Parameters<DomainEventHandler["handle"]>[0] & { eventId?: string };

export interface WebhookRelayOptions {
  /** Outbox event types to relay (the handler's registration filter). */
  eventTypes: readonly string[];
  /** Resolve the endpoints subscribed to this event (config, table, …). */
  endpointsFor: (
    event: RelayedDomainEvent,
  ) => Promise<readonly WebhookEndpointTarget[]> | readonly WebhookEndpointTarget[];
}

/**
 * Retry semantics (the part a project must NOT reinvent): delivery happens
 * inside the `events` processor, so a throw here re-runs the WHOLE handler
 * with BullMQ's attempts/backoff and lands in the DLQ when exhausted
 * (ADR 0043). All endpoints are attempted every run (`allSettled` — one dead
 * receiver can't starve the others) and a retry re-delivers to endpoints
 * that already succeeded: at-least-once, receivers dedup on
 * `X-Webhook-Id`. Per-endpoint isolation (only failed endpoints retry) is
 * the documented upgrade — a `webhooks` queue with one job per endpoint,
 * sketched in README.md.
 */
export function createWebhookRelayHandler(
  dispatcher: WebhookDispatcher,
  options: WebhookRelayOptions,
): DomainEventHandler {
  return {
    eventTypes: options.eventTypes,
    async handle(event: RelayedDomainEvent) {
      const endpoints = await options.endpointsFor(event);
      if (endpoints.length === 0) return;

      const results = await Promise.allSettled(
        endpoints.map((endpoint) =>
          dispatcher.deliver(
            endpoint.url,
            {
              // The outbox event id rides through the relay as `eventId`
              // (events.processor's RelayedEvent); fall back to a stable
              // composite so dedup keys never collapse to "undefined".
              id: event.eventId ?? `${event.aggregateId}:${event.eventType}`,
              type: event.eventType,
              payload: event.payload,
            },
            endpoint.secret,
          ),
        ),
      );

      const failures = results.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      if (failures.length > 0) {
        throw new AggregateError(
          failures.map((failure) => failure.reason as Error),
          `${failures.length}/${endpoints.length} webhook deliveries failed for ${event.eventType}`,
        );
      }
    },
  };
}
