/**
 * The write half of the transactional outbox (ADR 0037): `emit()` ONLY works
 * inside an active `@Transactional()` scope — the event row and the state
 * change share one transaction or the call throws. This is the "wrong thing
 * doesn't run" guarantee the whole pattern rests on.
 */
import { TransactionHost } from "@nestjs-cls/transactional";
import { type TransactionalAdapterDrizzleOrm } from "@nestjs-cls/transactional-adapter-drizzle-orm";
import { Injectable } from "@nestjs/common";
import { context, propagation } from "@opentelemetry/api";

import { type Db } from "@repo/db";
import { outbox } from "@repo/db/schema/outbox";

export interface DomainEvent {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  /** IDs only — never PII (spec §7.2). Processors re-fetch state. */
  payload: Record<string, unknown>;
}

@Injectable()
export class OutboxService {
  constructor(private readonly txHost: TransactionHost<TransactionalAdapterDrizzleOrm<Db>>) {}

  /** Returns the event id (UUIDv7 — also the BullMQ jobId after relay). */
  async emit(event: DomainEvent): Promise<string> {
    if (!this.txHost.isTransactionActive()) {
      throw new Error(
        "OutboxService.emit() requires an active @Transactional() scope " +
          "(ADR 0037) — an event outside the business transaction can be " +
          "published without its state change (or vice versa).",
      );
    }

    // Trace continuity (ADR 0036/0037): the event row carries the CURRENT
    // request's W3C trace context; the worker's events processor resumes it,
    // so a job's trace links back to the request that caused it. No-op
    // (empty carrier) when OTel is off.
    const carrier: Record<string, string> = {};
    propagation.inject(context.active(), carrier);

    const [row] = await this.txHost.tx
      .insert(outbox)
      .values({
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        eventType: event.eventType,
        payload: event.payload,
        traceparent: carrier.traceparent ?? null,
      })
      .returning({ id: outbox.id });

    return row!.id;
  }
}
