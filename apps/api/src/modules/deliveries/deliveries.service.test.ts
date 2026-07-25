/**
 * Service unit test (mocked collaborators) for the A2 send path (ADR 0129) —
 * it proves the four things that cannot be proved by reading the code:
 *
 *  - the frozen row carries the right facts per document class;
 *  - the outbox payload and the audit diff are IDs ONLY (THE pii test);
 *  - the guard ORDER holds, in particular `customer_anonymized` BEFORE
 *    `recipient_email_missing`;
 *  - every refusal path leaves NO event row and NO audit row.
 */
import { ConflictException, UnprocessableEntityException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { type DocumentDeliveryRow } from "@repo/db/schema/deliveries";

import { DeliveriesService } from "./deliveries.service.js";

vi.mock("@nestjs-cls/transactional", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@nestjs-cls/transactional")>()),
  Transactional: () => () => undefined,
}));

const SCOPE = { userId: "user-1", organizationId: "org-1" };
const NOW = new Date("2026-07-25T00:00:00.000Z");
const QUOTE_ID = "01890a5d-ac96-774b-bcce-b302099a0011";
const INVOICE_ID = "01890a5d-ac96-774b-bcce-b302099a0022";
const ORDER_ID = "01890a5d-ac96-774b-bcce-b302099a0033";
const CUSTOMER_ID = "01890a5d-ac96-774b-bcce-b302099a0044";
// A deliberately LOW-ENTROPY, self-evidently synthetic UUID. A random-looking
// fixture token trips the gitleaks `generic-api-key` rule on every commit, and
// the wrong fix is an allow-list entry: that trains the secret scanner to stay
// quiet about a variable literally named SHARE_TOKEN. Shape-valid, obviously fake.
const SHARE_TOKEN = "00000000-0000-4000-8000-000000000001";
/** The sentinel the PII assertions grep for. */
const BUYER_EMAIL = "buyer@example.cz";

function quoteDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: QUOTE_ID,
    documentNumber: "2026/0007",
    customerId: CUSTOMER_ID,
    shareToken: SHARE_TOKEN,
    supersededById: null,
    ...overrides,
  };
}

function invoiceDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: INVOICE_ID,
    orderId: ORDER_ID,
    documentNumber: "FV2026/0003",
    variableSymbol: "20260003",
    status: "issued",
    supersededById: null,
    ...overrides,
  };
}

/** The frozen ADR-0127 projection — money is the kernel's own dot-decimal string. */
function invoiceDocument(overrides: Record<string, unknown> = {}) {
  return {
    documentNumber: "FV2026/0003",
    currency: "CZK",
    variableSymbol: "20260003",
    dueDate: "2026-08-08",
    totalAmount: "129891.504",
    supplierIban: "CZ6508000000192000145399",
    ...overrides,
  };
}

function makeRow(overrides: Partial<DocumentDeliveryRow> = {}): DocumentDeliveryRow {
  return {
    id: "01890a5d-ac96-774b-bcce-b302099a0099",
    ownerId: SCOPE.userId,
    organizationId: SCOPE.organizationId,
    documentType: "quote",
    documentId: QUOTE_ID,
    documentNumber: "2026/0007",
    customerId: CUSTOMER_ID,
    recipientEmail: BUYER_EMAIL,
    locale: null,
    linkPath: `/nabidka/${SHARE_TOKEN}`,
    amountMoney: null,
    currency: null,
    variableSymbol: null,
    dueOn: null,
    payToIban: null,
    status: "queued",
    sentAt: null,
    failureReason: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

/** A Postgres 23505 shaped exactly like the driver's — the `.cause` walker in
 *  the service is what turns it into the 409. */
function uniqueViolation(constraint: string): Error {
  const inner = Object.assign(new Error("duplicate key value"), { code: "23505", constraint });
  return Object.assign(new Error("Failed query"), { cause: inner });
}

function makeService() {
  const deliveries = {
    list: vi.fn(),
    insert: vi
      .fn()
      .mockImplementation(async (_s: unknown, data: Partial<DocumentDeliveryRow>) => makeRow(data)),
    claimForSend: vi.fn(),
    markSent: vi.fn(),
    markFailed: vi.fn(),
  };
  const outbox = { emit: vi.fn().mockResolvedValue("event-id") };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const quotes = {
    get: vi.fn().mockResolvedValue(quoteDetail()),
    getInvoiceBasis: vi.fn().mockResolvedValue({ customerId: CUSTOMER_ID }),
  };
  const invoices = {
    get: vi.fn().mockResolvedValue(invoiceDetail()),
    getDocument: vi.fn().mockResolvedValue(invoiceDocument()),
  };
  const orders = { get: vi.fn().mockResolvedValue({ id: ORDER_ID, quoteId: QUOTE_ID }) };
  const customers = {
    getDeliveryRecipient: vi
      .fn()
      .mockResolvedValue({ id: CUSTOMER_ID, email: BUYER_EMAIL, anonymized: false }),
  };

  const service = new DeliveriesService(
    deliveries as never,
    outbox as never,
    audit as never,
    quotes as never,
    invoices as never,
    orders as never,
    customers as never,
  );
  return { service, deliveries, outbox, audit, quotes, invoices, orders, customers };
}

type Deps = ReturnType<typeof makeService>;

const sendQuote = { documentType: "quote", documentId: QUOTE_ID } as const;
const sendInvoice = { documentType: "invoice", documentId: INVOICE_ID } as const;

describe("DeliveriesService.send — quote", () => {
  it("queues a row linking the ADR-0089 public landing, emits IDs-only, audits", async () => {
    const deps = makeService();

    const result = await deps.service.send(SCOPE, "admin", sendQuote);

    const inserted = deps.deliveries.insert.mock.calls[0]![1] as Record<string, unknown>;
    expect(inserted.documentType).toBe("quote");
    expect(inserted.documentNumber).toBe("2026/0007");
    expect(inserted.linkPath).toBe(`/nabidka/${SHARE_TOKEN}`);
    expect(inserted.recipientEmail).toBe(BUYER_EMAIL);
    // A quote mail carries no payment figures at all.
    expect(inserted.amountMoney).toBeNull();
    expect(inserted.payToIban).toBeNull();
    expect(result.status).toBe("queued");

    expect(deps.outbox.emit).toHaveBeenCalledWith({
      aggregateType: "document_delivery",
      aggregateId: result.id,
      eventType: "document_delivery.requested",
      payload: { deliveryId: result.id },
    });

    const auditEntry = deps.audit.record.mock.calls[0]![0] as {
      action: string;
      diff: { after: Record<string, unknown> };
    };
    expect(auditEntry.action).toBe("document.send");
    expect(Object.keys(auditEntry.diff.after)).toEqual([
      "documentType",
      "documentId",
      "documentNumber",
      "customerId",
    ]);
  });

  it("never puts the recipient address in the outbox payload or the audit diff", async () => {
    const deps = makeService();

    await deps.service.send(SCOPE, "admin", sendQuote);

    // IDs ONLY — no PII in an outbox payload or an audit diff (ADR 0037/0040).
    const emitted = deps.outbox.emit.mock.calls[0]![0] as { payload: Record<string, unknown> };
    const auditEntry = deps.audit.record.mock.calls[0]![0] as unknown;
    expect(JSON.stringify(emitted)).not.toContain(BUYER_EMAIL);
    expect(JSON.stringify(auditEntry)).not.toContain(BUYER_EMAIL);
    // …and the payload has exactly one key.
    expect(Object.keys(emitted.payload)).toEqual(["deliveryId"]);
  });

  it("the response never carries the address, the link or the failure reason", async () => {
    const deps = makeService();
    const result = await deps.service.send(SCOPE, "admin", sendQuote);
    expect(JSON.stringify(result)).not.toContain(BUYER_EMAIL);
    expect(result).not.toHaveProperty("recipientEmail");
    expect(result).not.toHaveProperty("linkPath");
    expect(result).not.toHaveProperty("failureReason");
  });
});

describe("DeliveriesService.send — invoice", () => {
  it("freezes the payment identification from the FROZEN document, and no link", async () => {
    const deps = makeService();

    await deps.service.send(SCOPE, "admin", sendInvoice);

    const inserted = deps.deliveries.insert.mock.calls[0]![1] as Record<string, unknown>;
    expect(inserted.linkPath).toBeNull();
    // Byte-identical to the kernel's own formatted total — never reformatted.
    expect(inserted.amountMoney).toBe("129891.504");
    expect(inserted.currency).toBe("CZK");
    expect(inserted.variableSymbol).toBe("20260003");
    expect(inserted.dueOn).toBe("2026-08-08");
    expect(inserted.payToIban).toBe("CZ6508000000192000145399");
    // The buyer id came order → quote basis (the invoice row carries none).
    expect(deps.orders.get).toHaveBeenCalledWith(SCOPE, ORDER_ID);
    expect(deps.quotes.getInvoiceBasis).toHaveBeenCalledWith(SCOPE, QUOTE_ID);
    expect(inserted.customerId).toBe(CUSTOMER_ID);
  });

  it("propagates the ADR-0127 invoice_document_unreadable 422 unchanged", async () => {
    const deps = makeService();
    deps.invoices.getDocument.mockRejectedValue(
      new UnprocessableEntityException({
        message: "the frozen invoice document could not be read",
        code: "invoice_document_unreadable",
      }),
    );
    await expect(deps.service.send(SCOPE, "admin", sendInvoice)).rejects.toMatchObject({
      response: { code: "invoice_document_unreadable" },
    });
    expect(deps.outbox.emit).not.toHaveBeenCalled();
  });
});

describe("DeliveriesService.send — refusals", () => {
  it("409 document_superseded for a superseded quote", async () => {
    const deps = makeService();
    deps.quotes.get.mockResolvedValue(quoteDetail({ supersededById: "01890a5d-0000" }));
    await expect(deps.service.send(SCOPE, "admin", sendQuote)).rejects.toMatchObject({
      response: { code: "document_superseded" },
    });
    expect(deps.deliveries.insert).not.toHaveBeenCalled();
  });

  it("409 document_superseded for a superseded invoice — before the document is read", async () => {
    const deps = makeService();
    deps.invoices.get.mockResolvedValue(invoiceDetail({ supersededById: "01890a5d-0000" }));
    await expect(deps.service.send(SCOPE, "admin", sendInvoice)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(deps.invoices.getDocument).not.toHaveBeenCalled();
  });

  it("422 customer_required when the document has no attached buyer", async () => {
    const deps = makeService();
    deps.quotes.get.mockResolvedValue(quoteDetail({ customerId: null }));
    await expect(deps.service.send(SCOPE, "admin", sendQuote)).rejects.toMatchObject({
      response: { code: "customer_required" },
    });
    expect(deps.customers.getDeliveryRecipient).not.toHaveBeenCalled();
  });

  it("422 customer_required when the attached buyer no longer resolves", async () => {
    const deps = makeService();
    deps.customers.getDeliveryRecipient.mockResolvedValue(null);
    await expect(deps.service.send(SCOPE, "admin", sendQuote)).rejects.toMatchObject({
      response: { code: "customer_required" },
    });
  });

  it("422 customer_anonymized BEFORE recipient_email_missing (an erased row has email=null)", async () => {
    const deps = makeService();
    // Exactly the shape an Art.17 anonymize leaves behind.
    deps.customers.getDeliveryRecipient.mockResolvedValue({
      id: CUSTOMER_ID,
      email: null,
      anonymized: true,
    });
    // Reporting "add an e-mail address" here would invite the rep to re-enter
    // erased PII — an actual Art.17 defeat. The ORDER is the guard.
    await expect(deps.service.send(SCOPE, "admin", sendQuote)).rejects.toMatchObject({
      response: { code: "customer_anonymized" },
    });
  });

  it("422 recipient_email_missing when a live buyer has no address", async () => {
    const deps = makeService();
    deps.customers.getDeliveryRecipient.mockResolvedValue({
      id: CUSTOMER_ID,
      email: null,
      anonymized: false,
    });
    await expect(deps.service.send(SCOPE, "admin", sendQuote)).rejects.toMatchObject({
      response: { code: "recipient_email_missing" },
    });
  });

  it("409 send_in_progress on the partial-unique-index race", async () => {
    const deps = makeService();
    deps.deliveries.insert.mockRejectedValue(uniqueViolation("document_delivery_inflight_uq"));
    await expect(deps.service.send(SCOPE, "admin", sendQuote)).rejects.toMatchObject({
      response: { code: "send_in_progress" },
    });
  });

  it("rethrows an unrelated unique violation untouched", async () => {
    const deps = makeService();
    deps.deliveries.insert.mockRejectedValue(uniqueViolation("some_other_uq"));
    await expect(deps.service.send(SCOPE, "admin", sendQuote)).rejects.not.toBeInstanceOf(
      ConflictException,
    );
  });

  it.each<[string, (deps: Deps) => void]>([
    [
      "superseded quote",
      (d) => void d.quotes.get.mockResolvedValue(quoteDetail({ supersededById: "01890a5d-0000" })),
    ],
    ["no customer", (d) => void d.quotes.get.mockResolvedValue(quoteDetail({ customerId: null }))],
    [
      "anonymized customer",
      (d) =>
        void d.customers.getDeliveryRecipient.mockResolvedValue({
          id: CUSTOMER_ID,
          email: null,
          anonymized: true,
        }),
    ],
    [
      "no address",
      (d) =>
        void d.customers.getDeliveryRecipient.mockResolvedValue({
          id: CUSTOMER_ID,
          email: null,
          anonymized: false,
        }),
    ],
    [
      "in-flight send",
      (d) =>
        void d.deliveries.insert.mockRejectedValue(
          uniqueViolation("document_delivery_inflight_uq"),
        ),
    ],
  ])("leaves NO orphan event and NO audit row — %s", async (_label, arrange) => {
    const deps = makeService();
    arrange(deps);
    await expect(deps.service.send(SCOPE, "admin", sendQuote)).rejects.toBeDefined();
    expect(deps.outbox.emit).not.toHaveBeenCalled();
    expect(deps.audit.record).not.toHaveBeenCalled();
  });
});

describe("DeliveriesService.list", () => {
  it("maps role → ownership narrowing (ADR 0082) and never ships the address", async () => {
    const deps = makeService();
    deps.deliveries.list.mockResolvedValue({ items: [makeRow()], nextCursor: null });

    const query = {
      documentType: "quote",
      documentId: QUOTE_ID,
      limit: 20,
      sort: "createdAt:desc",
    } as const;

    const asSales = await deps.service.list(SCOPE, "sales", query);
    expect(deps.deliveries.list).toHaveBeenLastCalledWith(SCOPE, { restrictToOwner: true }, query);
    expect(JSON.stringify(asSales)).not.toContain(BUYER_EMAIL);

    await deps.service.list(SCOPE, "admin", query);
    expect(deps.deliveries.list).toHaveBeenLastCalledWith(SCOPE, { restrictToOwner: false }, query);
  });
});
