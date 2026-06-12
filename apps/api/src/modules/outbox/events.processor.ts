/**
 * Consumes the `events` queue (worker deployable). Delivery is
 * at-least-once: relay dedup is by jobId, but a completed-and-pruned job's id
 * frees up — handlers MUST be idempotent (ADR 0037).
 *
 * Domain modules register handlers via the `DOMAIN_EVENT_HANDLERS`
 * multi-provider; unhandled event types log a warning (the reference
 * resource's `projects-worker.module.ts` registers the example handlers).
 *
 * DLQ convention (ADR 0043): when retries are exhausted, the job is re-added
 * to the `dlq` queue with origin metadata. Replay = re-add to the origin
 * queue from bull-board (or a future admin action) using the recorded name
 * and data.
 */
import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { Inject, Logger, Optional } from "@nestjs/common";
import { context, propagation, SpanStatusCode, trace } from "@opentelemetry/api";
import { Queue, type Job } from "bullmq";

import { DOMAIN_EVENT_HANDLERS, QUEUES, type DomainEventHandler } from "../jobs/jobs.tokens.js";

export interface RelayedEvent {
  eventId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  traceparent?: string;
}

@Processor(QUEUES.events)
export class EventsProcessor extends WorkerHost {
  private readonly logger = new Logger(EventsProcessor.name);

  constructor(
    @InjectQueue(QUEUES.dlq) private readonly dlq: Queue,
    @Optional()
    @Inject(DOMAIN_EVENT_HANDLERS)
    private readonly handlers: DomainEventHandler[] = [],
  ) {
    super();
  }

  async process(job: Job<RelayedEvent>): Promise<void> {
    const event = job.data;
    const matched = this.handlers.filter((h) => h.eventTypes.includes(event.eventType));

    if (matched.length === 0) {
      this.logger.warn(`no handler for event type "${event.eventType}" (${event.eventId})`);
      return;
    }

    // Trace continuity (ADR 0036/0037): resume the W3C context the request
    // injected at emit time — the handler span joins the ORIGINATING trace.
    // With OTel off this is a no-op passthrough.
    const parentContext = event.traceparent
      ? propagation.extract(context.active(), { traceparent: event.traceparent })
      : context.active();

    await context.with(parentContext, () =>
      trace
        .getTracer("skeleton-worker")
        .startActiveSpan(
          `event ${event.eventType}`,
          { attributes: { "event.id": event.eventId, "event.type": event.eventType } },
          async (span) => {
            try {
              for (const handler of matched) {
                await handler.handle(event);
              }
            } catch (error) {
              span.setStatus({ code: SpanStatusCode.ERROR });
              throw error;
            } finally {
              span.end();
            }
          },
        ),
    );
  }

  @OnWorkerEvent("failed")
  async onFailed(job: Job<RelayedEvent> | undefined, error: Error): Promise<void> {
    if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;

    await this.dlq.add(job.name, {
      origin: { queue: QUEUES.events, jobId: job.id, name: job.name },
      failedReason: error.message,
      data: job.data,
    });
    this.logger.error(`event ${job.id} exhausted retries — moved to DLQ: ${error.message}`);
  }
}
