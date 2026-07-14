/**
 * Worker-side consumer of the order outbox events (ADR 0109; chain:
 * outbox → relay → events queue → here → Centrifugo). Payloads are IDs only
 * (ADR 0037), so the handler RE-FETCHES the row. Orders are org-visible (the
 * workshop, sales and admin all watch them), so the broadcast goes to the
 * `org:<id>` channel (ADR 0055), not a personal channel.
 *
 * Delivery is at-least-once: every branch is an idempotent no-op on re-run
 * (publish is fire-and-forget; a missing row is skipped).
 */
import { Injectable, Logger } from "@nestjs/common";

import { type DomainEventHandler } from "../jobs/jobs.tokens.js";
import { RealtimeService } from "../realtime/realtime.service.js";
import { orgChannel } from "../realtime/realtime.tokens.js";
import { OrdersRepository } from "./orders.repository.js";
import {
  ORDER_CANCELLED,
  ORDER_COMPLETED,
  ORDER_CONFIRMED,
  ORDER_PRODUCTION_STARTED,
} from "./orders.tokens.js";

@Injectable()
export class OrdersEventsHandler implements DomainEventHandler {
  private readonly logger = new Logger(OrdersEventsHandler.name);

  readonly eventTypes = [
    ORDER_CONFIRMED,
    ORDER_PRODUCTION_STARTED,
    ORDER_COMPLETED,
    ORDER_CANCELLED,
  ] as const;

  constructor(
    private readonly orders: OrdersRepository,
    private readonly realtime: RealtimeService,
  ) {}

  async handle(event: {
    eventType: string;
    aggregateType: string;
    aggregateId: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    const id = event.payload["orderId"];
    if (typeof id !== "string") {
      this.logger.error(`event ${event.eventType} carried no string orderId — skipping`);
      return;
    }

    const row = await this.orders.findByIdSystem(id);
    if (!row) {
      this.logger.warn(`order ${id} gone before ${event.eventType} was handled`);
      return;
    }

    // Fail-soft (RealtimeService logs failures): a Centrifugo outage must not
    // dead-letter domain events over a lost notification.
    await this.realtime.publish(orgChannel(row.organizationId), {
      type: event.eventType,
      orderId: row.id,
      status: row.status,
    });
  }
}
