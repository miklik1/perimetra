/**
 * Worker-side consumer of the document-delivery outbox event (ADR 0129) — the
 * ONLY place an A2 mail is actually handed to SMTP. The payload is IDs only
 * (`{ deliveryId }`, ADR 0037), so the handler RE-FETCHES the row from Postgres
 * and reads the recipient address there; the address never touches Redis.
 *
 * TWO RULINGS live in this file, and neither is an optimisation.
 *
 * 1. CLAIM-BEFORE-SEND MAKES DELIVERY AT-MOST-ONCE. Every other handler in the
 *    repo is at-least-once-safe because its only side effect is a fire-and-
 *    forget Centrifugo publish. An e-mail is not fire-and-forget: a double-send
 *    spams a real buyer. `removeOnComplete.age` frees the dedup jobId an hour
 *    after success, so a naive handler WOULD re-send. A `if (row.sentAt) return`
 *    read-then-write races two workers; only the CONDITIONAL claim
 *    (`queued`→`sending`, RETURNING) resolves the race structurally, at the
 *    storage layer.
 *
 * 2. THE CATCH DOES NOT RETHROW. Rethrowing would let BullMQ retry, but a retry
 *    after the claim can never send (the status is no longer `queued`), so it
 *    would be pure noise ending in a DLQ entry no rep ever sees. Marking the row
 *    `failed` and returning makes the failure VISIBLE on the rep surface — the
 *    honest signal — and the rep re-sends explicitly. Fail-soft in the same
 *    spirit as `InvoicesEventsHandler`, with a persisted, user-visible outcome
 *    instead of a silent swallow.
 *
 * The raw SMTP error NEVER reaches a log, a span or a persisted field: a 5xx
 * rejection routinely embeds the recipient address, and neither the pino body
 * redact paths (literal, depth-1) nor the Sentry scrubber (extra/contexts only)
 * reaches `event.exception.value`. Only the normalized code `"smtp_error"` is
 * stored, and the log line carries the delivery id and nothing else.
 *
 * A crash between the claim and either terminal write leaves the row in
 * `sending` forever. That is HONEST (neither confirmed nor failed), and the
 * partial unique index is scoped to `'queued'` ONLY so it never blocks a
 * re-send.
 *
 * A2 publishes NOTHING to Centrifugo: `RealtimeProvider` is consumed only by the
 * projects LIVE badge and there is no query-invalidation plumbing to hang a
 * delivery event off, so a publish would be dead weight.
 */
import { Inject, Injectable, Logger } from "@nestjs/common";

import { ENV, type Env } from "../../common/config/env.js";
import { EmailService } from "../email/email.service.js";
import { resolveLocale } from "../email/translator.js";
import { type DomainEventHandler } from "../jobs/jobs.tokens.js";
import { DeliveriesRepository } from "./deliveries.repository.js";
import { DOCUMENT_DELIVERY_REQUESTED } from "./deliveries.tokens.js";

/**
 * Format a §29 CALENDAR date for the mail. `timeZone: "UTC"` is the ADR-0105
 * rule for a statutory calendar date — without it a viewer west of UTC sees the
 * previous day and the mail disagrees with the printed sheet. `apps/api` has no
 * `@repo/utils` dependency, so `formatCalendarDate` is unavailable and the
 * dependency is deliberately NOT added for one call site.
 */
function formatDueDate(dueOn: string | null, locale: string | null): string | null {
  if (!dueOn) return null;
  return new Intl.DateTimeFormat(resolveLocale(locale), {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(dueOn));
}

@Injectable()
export class DeliveriesEventsHandler implements DomainEventHandler {
  private readonly logger = new Logger(DeliveriesEventsHandler.name);

  readonly eventTypes = [DOCUMENT_DELIVERY_REQUESTED] as const;

  constructor(
    private readonly deliveries: DeliveriesRepository,
    private readonly email: EmailService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async handle(event: {
    eventType: string;
    aggregateType: string;
    aggregateId: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    const id = event.payload["deliveryId"];
    if (typeof id !== "string") {
      // Poison payload — retrying can never fix it; log loudly and drop.
      this.logger.error(`event ${event.eventType} carried no string deliveryId — skipping`);
      return;
    }

    // THE double-send guard (ruling 1 above).
    const row = await this.deliveries.claimForSend(id);
    if (!row) {
      this.logger.warn(`document_delivery ${id} already claimed or gone — skipping`);
      return;
    }

    try {
      if (row.documentType === "quote") {
        await this.email.sendQuoteIssuedEmail({
          to: row.recipientEmail,
          documentNumber: row.documentNumber,
          quoteUrl: `${this.env.WEB_ORIGIN}${row.linkPath ?? ""}`,
          locale: row.locale,
        });
      } else {
        await this.email.sendInvoiceIssuedEmail({
          to: row.recipientEmail,
          documentNumber: row.documentNumber,
          variableSymbol: row.variableSymbol ?? "",
          amount: row.amountMoney ?? "",
          currency: row.currency ?? "",
          dueDate: formatDueDate(row.dueOn, row.locale),
          iban: row.payToIban,
          locale: row.locale,
        });
      }
    } catch {
      // The raw error is deliberately NOT bound, NOT logged and NOT rethrown —
      // see the file docblock. Only the normalized code is persisted.
      await this.deliveries.markFailed(id, "smtp_error");
      this.logger.error(`document_delivery ${id} could not be delivered (smtp_error)`);
      return;
    }

    await this.deliveries.markSent(id);
  }
}
