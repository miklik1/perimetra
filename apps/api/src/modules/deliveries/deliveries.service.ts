/**
 * Deliveries service (ADR 0129, Wave A2) — "send this document to its buyer".
 *
 * ONE `@Transactional()` method does the whole request-path job: resolve the
 * document through its OWNING service (cross-module, never a schema join —
 * ADR 0032), run the ordered guards, freeze a `document_delivery` row, emit ONE
 * IDs-only outbox event, audit, return. The actual SMTP hop happens in the
 * worker (`deliveries.events.ts`) — a slow or failing mail server must never
 * fail or stall a rep's action.
 *
 * THE ORDER IS THE CONTRACT (guards first, emit last): this is the invoices
 * module's "every guard runs BEFORE the number is burned" discipline restated
 * for an outward act. An outbox event the handler silently drops would be the
 * "silently not sending" failure the ADR-0126 honesty inversion forbids, so a
 * refused send must leave NO event row.
 *
 * PII posture (ADR 0037/0040): the recipient address is read LIVE from
 * `customer.email` (the only `pii()`-registered, GDPR-reachable, CURRENT
 * address) and is written ONLY to Postgres. It never enters the outbox payload
 * (`{ deliveryId }`, one key), never enters the audit diff (IDs only), and is
 * absent from `deliverySchema` so it cannot reach a response body. This module
 * must NEVER read `invoice.snapshot.buyerEmail` / `invoice.facts.buyer.email`:
 * that frozen identity sits outside the `pii()` registry with no invoices
 * `PrivacyHandler` (the invoices CONTEXT.md KNOWN GAP), and reading it would
 * turn a documented gap into an active unregistered-PII processing path.
 *
 * PROVISIONAL (CAR-27 pass 2): the accountant pass has not run. Sending a
 * document to a buyer is a fresh processing act; nothing here claims legal
 * correctness or compliance of that act, of the mail's characterisation, or of
 * the retention of `recipient_email`.
 */
import { Transactional } from "@nestjs-cls/transactional";
import { ConflictException, Injectable, UnprocessableEntityException } from "@nestjs/common";

import { type DocumentDeliveryRow } from "@repo/db/schema/deliveries";
import {
  type DeliveriesPage,
  type Delivery,
  type ListDeliveriesQuery,
  type SendDocumentInput,
} from "@repo/validators/deliveries";

import { type OrgRole } from "../../common/rbac/org-role.js";
import { type RequestScope } from "../../common/tenancy/request-scope.js";
import { AuditService } from "../audit/audit.service.js";
import { CustomersService } from "../customers/customers.service.js";
import { InvoicesService } from "../invoices/invoices.service.js";
import { OrdersService } from "../orders/orders.service.js";
import { OutboxService } from "../outbox/outbox.service.js";
import { QuotesService } from "../quotes/quotes.service.js";
import { DeliveriesRepository, type InsertDeliveryData } from "./deliveries.repository.js";
import { DOCUMENT_DELIVERY_REQUESTED } from "./deliveries.tokens.js";

/**
 * admin sees the whole org; every other rep is narrowed to the sends it made
 * (ADR 0082). Spelled `!== "admin"` — the fail-CLOSED direction: a role added
 * to the route's `@RequireRole` list later starts narrowed, and a too-small
 * visibility list is a visible bug where a too-large one is a silent leak.
 */
function scopeOpts(role: OrgRole): { restrictToOwner: boolean } {
  return { restrictToOwner: role !== "admin" };
}

/** DB row → the response contract. Everything the wire must NOT carry
 *  (recipientEmail, linkPath, failureReason, the payment figures) is simply
 *  never mapped — and `deliverySchema` would strip it anyway. */
function toDelivery(row: DocumentDeliveryRow): Delivery {
  return {
    id: row.id,
    documentType: row.documentType,
    documentId: row.documentId,
    documentNumber: row.documentNumber,
    customerId: row.customerId,
    status: row.status,
    sentAt: row.sentAt ? row.sentAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** The facts a mail is built from, assembled BEFORE the recipient is resolved. */
interface DocumentFacts {
  documentNumber: string;
  customerId: string | null;
  linkPath: string | null;
  amountMoney: string | null;
  currency: string | null;
  variableSymbol: string | null;
  dueOn: string | null;
  payToIban: string | null;
}

@Injectable()
export class DeliveriesService {
  constructor(
    private readonly deliveries: DeliveriesRepository,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly quotes: QuotesService,
    private readonly invoices: InvoicesService,
    private readonly orders: OrdersService,
    private readonly customers: CustomersService,
  ) {}

  async list(
    scope: RequestScope,
    role: OrgRole,
    query: ListDeliveriesQuery,
  ): Promise<DeliveriesPage> {
    const { items, nextCursor } = await this.deliveries.list(scope, scopeOpts(role), query);
    return { items: items.map(toDelivery), nextCursor };
  }

  /**
   * Queue a send. Ordered guards, ALL inside the transaction and ALL strictly
   * before `emit()`:
   *
   *  1. document resolved through its owning service → 404 (absent / other
   *     rep's / other org — one shape, never an existence oracle);
   *  2. superseded → 409 `document_superseded` (a forwarded stale offer must
   *     never be re-transmitted; the rep sends the newer revision deliberately);
   *  3. buyer id resolved → 422 `customer_required`;
   *  4. buyer anonymized → 422 `customer_anonymized` — checked BEFORE the
   *     missing-address branch on purpose: an anonymized row already has
   *     `email = null`, and telling a rep to "add an e-mail address" would
   *     invite them to re-enter erased PII, an actual Art.17 defeat;
   *  5. no address → 422 `recipient_email_missing` (the honest typed refusal,
   *     never a silent no-send);
   *  6. a send already queued for this document → 409 `send_in_progress`,
   *     decided by the partial unique index at the storage layer, not by a
   *     read-then-write check.
   *
   * On the invoice path `InvoicesService.getDocument` may itself throw the
   * shipped ADR-0127 422 `invoice_document_unreadable`. It propagates
   * UNCHANGED — a frozen document that will not parse must not be summarised
   * into a mail.
   */
  @Transactional()
  async send(scope: RequestScope, role: OrgRole, input: SendDocumentInput): Promise<Delivery> {
    const facts =
      input.documentType === "quote"
        ? await this.quoteFacts(scope, role, input.documentId)
        : await this.invoiceFacts(scope, role, input.documentId);

    if (!facts.customerId) {
      throw new UnprocessableEntityException({
        message: "the document has no attached customer — there is no one to send it to",
        code: "customer_required",
      });
    }

    const recipient = await this.customers.getDeliveryRecipient(scope, facts.customerId);
    if (!recipient) {
      throw new UnprocessableEntityException({
        message: "the document has no attached customer — there is no one to send it to",
        code: "customer_required",
      });
    }
    if (recipient.anonymized) {
      throw new UnprocessableEntityException({
        message: "the attached customer was anonymized — cannot send them a document",
        code: "customer_anonymized",
      });
    }
    if (!recipient.email) {
      throw new UnprocessableEntityException({
        message: "the customer has no e-mail address on record",
        code: "recipient_email_missing",
      });
    }

    const data: InsertDeliveryData = {
      documentType: input.documentType,
      documentId: input.documentId,
      documentNumber: facts.documentNumber,
      customerId: facts.customerId,
      recipientEmail: recipient.email,
      // No buyer-locale source exists (a customer carries no locale column), so
      // the mail falls back to DEFAULT_LOCALE (cs) in `resolveLocale`. The
      // column is here so a future buyer-preference read is a data change, not
      // a schema migration.
      locale: null,
      linkPath: facts.linkPath,
      amountMoney: facts.amountMoney,
      currency: facts.currency,
      variableSymbol: facts.variableSymbol,
      dueOn: facts.dueOn,
      payToIban: facts.payToIban,
    };

    let row: DocumentDeliveryRow;
    try {
      row = await this.deliveries.insert(scope, data);
    } catch (err) {
      if (isUniqueViolation(err, "document_delivery_inflight_uq")) {
        throw new ConflictException({
          message: "a send for this document is already in flight",
          code: "send_in_progress",
        });
      }
      throw err;
    }

    await this.emit(row.id);
    await this.audit.record({
      actorId: scope.userId,
      action: "document.send",
      entityType: "document_delivery",
      entityId: row.id,
      // IDs and non-PII fields ONLY (ADR 0040) — constraint "to whom" is
      // satisfied by `customerId`. The address NEVER lands here.
      diff: {
        before: null,
        after: {
          documentType: row.documentType,
          documentId: row.documentId,
          documentNumber: row.documentNumber,
          customerId: row.customerId,
        },
      },
    });
    return toDelivery(row);
  }

  /**
   * Quote facts. The mail genuinely DELIVERS the nabídka: `linkPath` targets the
   * already-shipped ADR-0089 public landing, which renders the full priced
   * document off the frozen snapshot and offers accept/decline. Nothing else is
   * frozen — the landing renders `validUntil` and its own expired banner, so the
   * mail never restates a deadline it could get wrong across a timezone.
   *
   * The token rides the URL FRAGMENT (`/nabidka#<shareToken>`, ADR 0130), not a
   * path segment. `linkPath` is therefore path+fragment rather than a bare path,
   * and the events handler's `${WEB_ORIGIN}${linkPath}` concatenation already
   * produces the correct absolute URL — a fragment must be appended to
   * origin+path, which is exactly what that concatenation does. A side benefit
   * worth naming: a server-side link scanner (Safe Links, Proofpoint) that
   * pre-fetches the mailed URL now receives a contentless `/nabidka` and can
   * neither resolve the quote nor burn the buyer's throttle budget.
   */
  private async quoteFacts(
    scope: RequestScope,
    role: OrgRole,
    quoteId: string,
  ): Promise<DocumentFacts> {
    const quote = await this.quotes.get(scope, role, quoteId);
    this.assertNotSuperseded(quote.supersededById);
    return {
      documentNumber: quote.documentNumber,
      customerId: quote.customerId,
      linkPath: `/nabidka#${quote.shareToken}`,
      amountMoney: null,
      currency: null,
      variableSymbol: null,
      dueOn: null,
      payToIban: null,
    };
  }

  /**
   * Invoice facts. The payment figures come from the FROZEN ADR-0127 document
   * projection, never from a live `legal_profile` read: the mail must state the
   * same IBAN, total and due date the §29 sheet states, and a live read could
   * disagree with the frozen doklad. `linkPath` is null by construction — the
   * invoice mail is a NOTIFICATION that carries no document link (ADR 0129).
   *
   * The buyer id is resolved order → quote → `getInvoiceBasis` (the invoice row
   * carries none). `OrdersService.get` is used rather than
   * `assertIssuableForInvoice`, because the order already HAS an invoice by the
   * time we send and the issuable guard would refuse; a plain org-scoped read is
   * the right primitive, and the access gate is the invoice read that already
   * happened (org-scoped AND owner-narrowed).
   */
  private async invoiceFacts(
    scope: RequestScope,
    role: OrgRole,
    invoiceId: string,
  ): Promise<DocumentFacts> {
    const invoice = await this.invoices.get(scope, role, invoiceId);
    this.assertNotSuperseded(invoice.supersededById);
    const document = await this.invoices.getDocument(scope, role, invoiceId);
    const order = await this.orders.get(scope, invoice.orderId);
    const basis = await this.quotes.getInvoiceBasis(scope, order.quoteId);
    return {
      documentNumber: invoice.documentNumber,
      customerId: basis.customerId,
      linkPath: null,
      // The kernel's own `formatCents` output, frozen VERBATIM — money
      // formatting is kernel-owned (the 2026-07-14 no-duplication ruling), so
      // the mail prints exactly what the sheet prints.
      amountMoney: document.totalAmount,
      currency: document.currency,
      variableSymbol: document.variableSymbol,
      dueOn: document.dueDate,
      payToIban: document.supplierIban,
    };
  }

  /** A superseded document must never be re-transmitted: a buyer who forwards a
   *  stale offer is how a rep ends up honouring terms nobody agreed to. The rep
   *  sends the newer revision deliberately. No `details` payload — A2 carries no
   *  typed error context (the shipped `errorMessageKey` code map is enough). */
  private assertNotSuperseded(supersededById: string | null): void {
    if (supersededById) {
      throw new ConflictException({
        message: "the document has been superseded by a newer version",
        code: "document_superseded",
      });
    }
  }

  /** IDs ONLY (ADR 0037): the worker RE-FETCHES the row from Postgres, so no
   *  buyer address ever enters the outbox payload or the BullMQ job data and
   *  Redis stays non-PII-bearing and rebuildable. Emitting outside the
   *  `@Transactional()` scope throws — by construction. */
  private emit(deliveryId: string): Promise<string> {
    return this.outbox.emit({
      aggregateType: "document_delivery",
      aggregateId: deliveryId,
      eventType: DOCUMENT_DELIVERY_REQUESTED,
      payload: { deliveryId },
    });
  }
}

/** A Postgres unique-violation (23505) on the named constraint — walks the
 *  DrizzleQueryError `.cause` chain (copied from the invoices module). */
function isUniqueViolation(err: unknown, constraint: string): boolean {
  let current: unknown = err;
  while (current instanceof Error) {
    const pg = current as Error & { code?: unknown; constraint?: unknown };
    if (pg.code === "23505" && pg.constraint === constraint) return true;
    current = pg.cause;
  }
  return false;
}
