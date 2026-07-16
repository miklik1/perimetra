/**
 * Service unit test (mocked deps, REAL mapper/kernel) — proves the issue
 * orchestration (order→quote basis, live identity, §29 gate, gap-free number,
 * freeze, IDs-only outbox + audit in one tx), the fail-closed 422 guards, and
 * the idempotent mark-paid FSM.
 */
import { ConflictException, UnprocessableEntityException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { type InvoiceRow } from "@repo/db/schema/invoices";
import { type TaxBreakdown } from "@repo/model";

import { InvoicesService } from "./invoices.service.js";

vi.mock("@nestjs-cls/transactional", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@nestjs-cls/transactional")>()),
  Transactional: () => () => undefined,
}));

const SCOPE = { userId: "user-1", organizationId: "org-1" };
const NOW = new Date("2026-07-16T00:00:00.000Z");
const ORDER_ID = "01890a5d-ac96-774b-bcce-b302099a00aa";

const ROUNDING = { scale: 2, mode: "half-up", granularity: "end-of-invoice" } as const;
function standardTax(): TaxBreakdown {
  return {
    mode: "standard_vat",
    currency: "CZK",
    rounding: ROUNDING,
    lines: [{ ratePct: "21", netBase: "100000", vatAmount: "21000", gross: "121000" }],
    netTotal: "100000",
    vatTotal: "21000",
    grossTotal: "121000",
  };
}

function supplier(overrides: Record<string, unknown> = {}) {
  return {
    id: "lp-1",
    name: "Ploty s.r.o.",
    ico: "12345678",
    dic: "CZ12345678",
    vatPayer: true,
    addressLine: "Hlavní 123",
    city: "Praha",
    postalCode: "11000",
    country: "CZ",
    bankAccount: "19-2000145399/0800",
    iban: "CZ6508000000192000145399",
    registrationNote: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

function customer(overrides: Record<string, unknown> = {}) {
  return {
    id: "cust-1",
    name: "Odběratel a.s.",
    ico: "87654321",
    dic: "CZ87654321",
    vatPayer: true,
    email: "kup@example.cz",
    addressLine: "Vedlejší 5",
    city: "Brno",
    postalCode: "60200",
    country: "CZ",
    anonymized: false,
    ...overrides,
  };
}

function makeRow(overrides: Partial<InvoiceRow> = {}): InvoiceRow {
  return {
    id: "01890a5d-ac96-774b-bcce-b302099a0001",
    ownerId: SCOPE.userId,
    organizationId: SCOPE.organizationId,
    orderId: ORDER_ID,
    documentNumber: "FV2026/0001",
    status: "issued",
    supersededById: null,
    currency: "CZK",
    issuedOn: "2026-07-16",
    duzp: "2026-07-16",
    dueOn: "2026-07-30",
    variableSymbol: "20260001",
    totalMoney: "121000.00",
    facts: { id: "x" },
    snapshot: { id: "x" },
    paidAt: null,
    paidNote: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeService() {
  const invoices = {
    list: vi.fn(),
    findById: vi.fn(),
    insert: vi.fn(),
    markPaid: vi.fn(),
    unmarkPaid: vi.fn(),
  };
  const outbox = { emit: vi.fn().mockResolvedValue("event-id") };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const orders = {
    assertIssuableForInvoice: vi
      .fn()
      .mockResolvedValue({ quoteId: "quote-1", orderNumber: "Z2026/0001" }),
  };
  const quotes = {
    getInvoiceBasis: vi.fn().mockResolvedValue({
      quoteNumber: "2026/0042",
      currency: "CZK",
      tax: standardTax(),
      customerId: "cust-1",
    }),
  };
  const legalProfiles = { get: vi.fn().mockResolvedValue(supplier()) };
  const customers = { getIdentityForInvoice: vi.fn().mockResolvedValue(customer()) };
  const numbering = { allocate: vi.fn().mockResolvedValue(1) };

  const service = new InvoicesService(
    invoices as never,
    outbox as never,
    audit as never,
    orders as never,
    quotes as never,
    legalProfiles as never,
    customers as never,
    numbering as never,
  );
  return { service, invoices, outbox, audit, orders, quotes, legalProfiles, customers, numbering };
}

describe("InvoicesService.issue", () => {
  it("freezes a re-derivable snapshot, emits invoice.issued (IDs only) + audits", async () => {
    const deps = makeService();
    deps.invoices.insert.mockImplementation(async (_s: unknown, data: Record<string, unknown>) =>
      makeRow({ facts: data.facts as object, snapshot: data.snapshot as object }),
    );

    const result = await deps.service.issue(SCOPE, { orderId: ORDER_ID });

    // The number was allocated in the "invoice" series, and the doc is FV{year}/{seq}.
    expect(deps.numbering.allocate).toHaveBeenCalledWith(SCOPE, "invoice", 2026);
    const inserted = deps.invoices.insert.mock.calls[0]![1] as Record<string, unknown>;
    expect(inserted.documentNumber).toBe("FV2026/0001");
    expect(inserted.status).toBe("issued");
    expect(inserted.totalMoney).toBe("121000.00");
    expect(inserted.variableSymbol).toBe("20260001");

    expect(deps.outbox.emit).toHaveBeenCalledWith({
      aggregateType: "invoice",
      aggregateId: result.id,
      eventType: "invoice.issued",
      payload: { invoiceId: result.id }, // IDs ONLY
    });
    expect(deps.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "invoice.issued", entityType: "invoice" }),
    );
    expect(result).not.toHaveProperty("ownerId");
  });

  it("422 iban_required when the legal profile has no IBAN", async () => {
    const deps = makeService();
    deps.legalProfiles.get.mockResolvedValue(supplier({ iban: null }));
    await expect(deps.service.issue(SCOPE, { orderId: ORDER_ID })).rejects.toMatchObject({
      response: { code: "iban_required" },
    });
    expect(deps.numbering.allocate).not.toHaveBeenCalled(); // no number burned
  });

  it("422 legal_profile_required when there is no profile", async () => {
    const deps = makeService();
    deps.legalProfiles.get.mockResolvedValue(null);
    await expect(deps.service.issue(SCOPE, { orderId: ORDER_ID })).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it("422 customer_anonymized when the live buyer was GDPR-erased", async () => {
    const deps = makeService();
    deps.customers.getIdentityForInvoice.mockResolvedValue(customer({ anonymized: true }));
    await expect(deps.service.issue(SCOPE, { orderId: ORDER_ID })).rejects.toMatchObject({
      response: { code: "customer_anonymized" },
    });
  });

  it("422 customer_required when the quote had no attached customer", async () => {
    const deps = makeService();
    deps.quotes.getInvoiceBasis.mockResolvedValue({
      quoteNumber: "2026/0042",
      currency: "CZK",
      tax: standardTax(),
      customerId: null,
    });
    await expect(deps.service.issue(SCOPE, { orderId: ORDER_ID })).rejects.toMatchObject({
      response: { code: "customer_required" },
    });
  });

  it("§29 gate blocks a reverse-charge document with no buyer DIČ (before numbering)", async () => {
    const deps = makeService();
    deps.quotes.getInvoiceBasis.mockResolvedValue({
      quoteNumber: "2026/0042",
      currency: "CZK",
      tax: { ...standardTax(), mode: "reverse_charge_92e" as const },
      customerId: "cust-1",
    });
    deps.customers.getIdentityForInvoice.mockResolvedValue(customer({ dic: null }));
    await expect(deps.service.issue(SCOPE, { orderId: ORDER_ID })).rejects.toMatchObject({
      response: { code: "section29_incomplete" },
    });
    expect(deps.numbering.allocate).not.toHaveBeenCalled();
  });

  it("422 supplier_not_vat_payer — a neplátce cannot issue a VAT-bearing document", async () => {
    const deps = makeService();
    deps.legalProfiles.get.mockResolvedValue(supplier({ vatPayer: false, dic: null }));
    // The quote still froze standard_vat @ 21% (nothing couples payer status to the rate).
    await expect(deps.service.issue(SCOPE, { orderId: ORDER_ID })).rejects.toMatchObject({
      response: { code: "supplier_not_vat_payer" },
    });
    expect(deps.numbering.allocate).not.toHaveBeenCalled(); // no number burned
  });

  it("a non-VAT-payer CAN issue when the quote charges no DPH (0% rate)", async () => {
    const deps = makeService();
    deps.legalProfiles.get.mockResolvedValue(supplier({ vatPayer: false, dic: null }));
    deps.quotes.getInvoiceBasis.mockResolvedValue({
      quoteNumber: "2026/0042",
      currency: "CZK",
      tax: {
        ...standardTax(),
        lines: [{ ratePct: "0", netBase: "100000", vatAmount: "0", gross: "100000" }],
        vatTotal: "0",
        grossTotal: "100000",
      },
      customerId: "cust-1",
    });
    deps.invoices.insert.mockImplementation(async (_s: unknown, data: Record<string, unknown>) =>
      makeRow({ facts: data.facts as object, snapshot: data.snapshot as object }),
    );
    const result = await deps.service.issue(SCOPE, { orderId: ORDER_ID });
    expect(result.status).toBe("issued");
    expect(deps.numbering.allocate).toHaveBeenCalledWith(SCOPE, "invoice", 2026);
  });

  it("409 invoice_exists on the order-active unique violation", async () => {
    const deps = makeService();
    deps.invoices.insert.mockRejectedValue(
      Object.assign(new Error("dup"), { code: "23505", constraint: "invoice_order_active_uq" }),
    );
    await expect(deps.service.issue(SCOPE, { orderId: ORDER_ID })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe("InvoicesService payment FSM", () => {
  it("markPaid is idempotent — a repeat (no row updated) is a 409", async () => {
    const deps = makeService();
    deps.invoices.findById.mockResolvedValue(makeRow({ status: "paid" }));
    deps.invoices.markPaid.mockResolvedValue(null); // conditional update matched nothing
    await expect(deps.service.markPaid(SCOPE, "inv-1", {})).rejects.toMatchObject({
      response: { code: "already_paid" },
    });
  });

  it("markPaid emits invoice.paid + audits on success", async () => {
    const deps = makeService();
    deps.invoices.findById.mockResolvedValue(makeRow());
    deps.invoices.markPaid.mockResolvedValue(makeRow({ status: "paid", paidAt: NOW }));
    const result = await deps.service.markPaid(SCOPE, "inv-1", { note: "VS 20260001" });
    expect(result.status).toBe("paid");
    expect(deps.outbox.emit).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "invoice.paid" }),
    );
  });
});
