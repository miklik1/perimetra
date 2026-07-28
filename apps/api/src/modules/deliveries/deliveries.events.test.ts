/**
 * Worker-handler unit test (ADR 0129). It pins the two rulings the handler is
 * built around — the CONDITIONAL claim (at-most-once delivery) and the
 * non-rethrowing catch — plus the redaction promise: a raw SMTP rejection
 * embeds the recipient address, and NEITHER the address NOR the SMTP text may
 * reach a log line or a persisted column.
 */
import { Logger } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type DocumentDeliveryRow } from "@repo/db/schema/deliveries";

import { DeliveriesEventsHandler } from "./deliveries.events.js";
import { DOCUMENT_DELIVERY_REQUESTED } from "./deliveries.tokens.js";

const NOW = new Date("2026-07-25T00:00:00.000Z");
const DELIVERY_ID = "01890a5d-ac96-774b-bcce-b302099a0099";
// A deliberately LOW-ENTROPY, self-evidently synthetic UUID. A random-looking
// fixture token trips the gitleaks `generic-api-key` rule on every commit, and
// the wrong fix is an allow-list entry: that trains the secret scanner to stay
// quiet about a variable literally named SHARE_TOKEN. Shape-valid, obviously fake.
const SHARE_TOKEN = "00000000-0000-4000-8000-000000000001";
const BUYER_EMAIL = "buyer@example.cz";
const WEB_ORIGIN = "http://localhost:3002";

function makeRow(overrides: Partial<DocumentDeliveryRow> = {}): DocumentDeliveryRow {
  return {
    id: DELIVERY_ID,
    ownerId: "user-1",
    organizationId: "org-1",
    documentType: "quote",
    documentId: "01890a5d-ac96-774b-bcce-b302099a0011",
    documentNumber: "2026/0007",
    customerId: "01890a5d-ac96-774b-bcce-b302099a0044",
    recipientEmail: BUYER_EMAIL,
    locale: null,
    linkPath: `/nabidka#${SHARE_TOKEN}`,
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

function invoiceRow(): DocumentDeliveryRow {
  return makeRow({
    documentType: "invoice",
    documentId: "01890a5d-ac96-774b-bcce-b302099a0022",
    documentNumber: "FV2026/0003",
    linkPath: null,
    amountMoney: "129891.504",
    currency: "CZK",
    variableSymbol: "20260003",
    dueOn: "2026-08-08",
    payToIban: "CZ6508000000192000145399",
  });
}

function makeHandler() {
  const deliveries = {
    claimForSend: vi.fn().mockResolvedValue(makeRow()),
    markSent: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
  };
  const email = {
    sendQuoteIssuedEmail: vi.fn().mockResolvedValue(undefined),
    sendInvoiceIssuedEmail: vi.fn().mockResolvedValue(undefined),
  };
  const handler = new DeliveriesEventsHandler(
    deliveries as never,
    email as never,
    { WEB_ORIGIN } as never,
  );
  return { handler, deliveries, email };
}

function event(payload: Record<string, unknown>) {
  return {
    eventType: DOCUMENT_DELIVERY_REQUESTED,
    aggregateType: "document_delivery",
    aggregateId: DELIVERY_ID,
    payload,
  };
}

/** Everything the handler's logger emitted this test, flattened to one string. */
let logged: string[];

beforeEach(() => {
  logged = [];
  for (const level of ["error", "warn", "log", "debug", "verbose"] as const) {
    vi.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DeliveriesEventsHandler", () => {
  it("sends the quote mail with the absolute ADR-0089 landing URL and marks sent", async () => {
    const deps = makeHandler();

    await deps.handler.handle(event({ deliveryId: DELIVERY_ID }));

    expect(deps.email.sendQuoteIssuedEmail).toHaveBeenCalledWith({
      to: BUYER_EMAIL,
      documentNumber: "2026/0007",
      quoteUrl: `${WEB_ORIGIN}/nabidka#${SHARE_TOKEN}`,
      locale: null,
    });
    expect(deps.email.sendInvoiceIssuedEmail).not.toHaveBeenCalled();
    expect(deps.deliveries.markSent).toHaveBeenCalledWith(DELIVERY_ID);
    expect(deps.deliveries.markFailed).not.toHaveBeenCalled();
  });

  it("sends the invoice mail with the frozen figures and a UTC-pinned due date", async () => {
    const deps = makeHandler();
    deps.deliveries.claimForSend.mockResolvedValue(invoiceRow());

    await deps.handler.handle(event({ deliveryId: DELIVERY_ID }));

    const input = deps.email.sendInvoiceIssuedEmail.mock.calls[0]![0] as Record<string, unknown>;
    expect(input.to).toBe(BUYER_EMAIL);
    expect(input.documentNumber).toBe("FV2026/0003");
    expect(input.variableSymbol).toBe("20260003");
    // Verbatim kernel money — never reformatted for the mail.
    expect(input.amount).toBe("129891.504");
    expect(input.currency).toBe("CZK");
    expect(input.iban).toBe("CZ6508000000192000145399");
    // A statutory CALENDAR date pinned to UTC (ADR 0105): the 8th, never the 7th.
    expect(input.dueDate).toBe(
      new Intl.DateTimeFormat("cs", { dateStyle: "long", timeZone: "UTC" }).format(
        new Date("2026-08-08"),
      ),
    );
    expect(String(input.dueDate)).toContain("8");
    expect(deps.email.sendQuoteIssuedEmail).not.toHaveBeenCalled();
  });

  it("omits a null due date rather than inventing one", async () => {
    const deps = makeHandler();
    deps.deliveries.claimForSend.mockResolvedValue(invoiceRow2());

    await deps.handler.handle(event({ deliveryId: DELIVERY_ID }));

    const input = deps.email.sendInvoiceIssuedEmail.mock.calls[0]![0] as Record<string, unknown>;
    expect(input.dueDate).toBeNull();
    expect(input.iban).toBeNull();
  });

  it("THE double-send guard: a lost claim sends nothing at all", async () => {
    const deps = makeHandler();
    deps.deliveries.claimForSend.mockResolvedValue(null);

    await deps.handler.handle(event({ deliveryId: DELIVERY_ID }));

    expect(deps.email.sendQuoteIssuedEmail).not.toHaveBeenCalled();
    expect(deps.email.sendInvoiceIssuedEmail).not.toHaveBeenCalled();
    expect(deps.deliveries.markSent).not.toHaveBeenCalled();
    expect(deps.deliveries.markFailed).not.toHaveBeenCalled();
  });

  it("an SMTP failure is normalized, RESOLVES, and never leaks the address or the 5xx text", async () => {
    const deps = makeHandler();
    deps.email.sendQuoteIssuedEmail.mockRejectedValue(
      new Error(`550 5.1.1 <${BUYER_EMAIL}> user unknown`),
    );

    // Resolves — deliberately NOT rethrown: a BullMQ retry after the claim could
    // never send, so it would only produce a DLQ entry no rep ever sees.
    await expect(deps.handler.handle(event({ deliveryId: DELIVERY_ID }))).resolves.toBeUndefined();

    expect(deps.deliveries.markFailed).toHaveBeenCalledWith(DELIVERY_ID, "smtp_error");
    expect(deps.deliveries.markSent).not.toHaveBeenCalled();

    const output = logged.join("\n");
    expect(output).not.toContain(BUYER_EMAIL);
    expect(output).not.toContain("550");
    expect(output).toContain("smtp_error");
  });

  it("a non-string deliveryId never touches the repository", async () => {
    const deps = makeHandler();
    await deps.handler.handle(event({ deliveryId: 42 }));
    expect(deps.deliveries.claimForSend).not.toHaveBeenCalled();
  });
});

/** An invoice delivery with no due date and no IBAN on the frozen document. */
function invoiceRow2(): DocumentDeliveryRow {
  return makeRow({
    documentType: "invoice",
    documentNumber: "FV2026/0004",
    linkPath: null,
    amountMoney: "1000.00",
    currency: "CZK",
    variableSymbol: "20260004",
    dueOn: null,
    payToIban: null,
  });
}
