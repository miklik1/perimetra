/**
 * Worker-side consumer of the invoice outbox events (spec §7.8 chain:
 * outbox → relay → events queue → here → Centrifugo). Payloads are IDs only
 * (ADR 0037), so the handler RE-FETCHES the row for fresh state. Publishes to the
 * `org:<id>` channel (ADR 0055) — an invoice is org-visible (admin/sales), not a
 * personal artifact.
 *
 * Delivery is at-least-once: every branch is an idempotent no-op when re-run
 * (publish is fire-and-forget state-free; a missing row is skipped).
 */
import { Injectable, Logger } from "@nestjs/common";

import { type DomainEventHandler } from "../jobs/jobs.tokens.js";
import { RealtimeService } from "../realtime/realtime.service.js";
import { orgChannel } from "../realtime/realtime.tokens.js";
import { InvoicesRepository } from "./invoices.repository.js";
import { INVOICE_ISSUED, INVOICE_PAID } from "./invoices.tokens.js";

@Injectable()
export class InvoicesEventsHandler implements DomainEventHandler {
  private readonly logger = new Logger(InvoicesEventsHandler.name);

  readonly eventTypes = [INVOICE_ISSUED, INVOICE_PAID] as const;

  constructor(
    private readonly invoices: InvoicesRepository,
    private readonly realtime: RealtimeService,
  ) {}

  async handle(event: {
    eventType: string;
    aggregateType: string;
    aggregateId: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    const id = event.payload["invoiceId"];
    if (typeof id !== "string") {
      this.logger.error(`event ${event.eventType} carried no string invoiceId — skipping`);
      return;
    }

    const row = await this.invoices.findByIdSystem(id);
    if (!row) {
      this.logger.warn(`invoice ${id} gone before ${event.eventType} was handled`);
      return;
    }

    // Fail-soft (RealtimeService logs failures): a Centrifugo outage must not
    // dead-letter domain events over a lost notification.
    await this.realtime.publish(orgChannel(row.organizationId), {
      type: event.eventType,
      invoiceId: row.id,
    });
  }
}
