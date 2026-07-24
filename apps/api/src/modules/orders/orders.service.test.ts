/**
 * OrdersService unit tests (ADR 0109 / ADR-O1) — the orchestration: the
 * accepted-quote guard, the one-live-order-per-DEAL chain guard (ADR 0126),
 * gap-free number allocation, the IDs-only outbox event + audit row in one tx,
 * the state-machine guards, the `order_quote_active_uq` race → 409, and the
 * production re-home delegating to `QuotesService`. Live DB behavior (the
 * partial-unique race, gap-free numbering, the real revision chain) is proven in
 * `apps/api/test/orders.itest.ts`.
 */
import { ConflictException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { type OrderRow } from "@repo/db/schema/orders";

import { numberingYear } from "../numbering/numbering-year.js";
import { OrdersService } from "./orders.service.js";

// `@Transactional()` resolves a live TransactionHost at CALL time — neutralize
// the wrapper so the unit under test is the service's orchestration.
vi.mock("@nestjs-cls/transactional", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@nestjs-cls/transactional")>()),
  Transactional: () => () => undefined,
}));

const SCOPE = { userId: "user-1", organizationId: "org-1" };
const NOW = new Date("2026-01-01T00:00:00.000Z");
const QUOTE_ID = "01890a5d-ac96-774b-bcce-b302099a0aaa";
const REVISION_ID = "01890a5d-ac96-774b-bcce-b302099a0bbb";
const ORDER_ID = "01890a5d-ac96-774b-bcce-b302099a0001";
/** The series year the service must use — Prague-pinned, not the server clock
 *  (ADR 0126). Derived, not hardcoded, so the suite does not rot on 1 January. */
const YEAR = numberingYear();

function makeRow(overrides: Partial<OrderRow> = {}): OrderRow {
  return {
    id: ORDER_ID,
    ownerId: SCOPE.userId,
    organizationId: SCOPE.organizationId,
    quoteId: QUOTE_ID,
    orderNumber: `Z${YEAR}/0001`,
    status: "confirmed",
    cancelReason: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeService() {
  const repo = {
    list: vi.fn(),
    findById: vi.fn(),
    findByIdSystem: vi.fn(),
    findLiveByQuoteIds: vi.fn().mockResolvedValue(null),
    insert: vi.fn(),
    setStatus: vi.fn(),
    repoint: vi.fn(),
  };
  const outbox = { emit: vi.fn().mockResolvedValue("event-id") };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const quotes = {
    assertAcceptedForOrder: vi.fn().mockResolvedValue(undefined),
    assertRepointTarget: vi.fn().mockResolvedValue(undefined),
    // Default: a lone quote — the chain is just itself, so the sibling set is empty.
    chainQuoteIds: vi.fn().mockResolvedValue([QUOTE_ID]),
    getProductionByQuoteId: vi.fn(),
  };
  const numbering = { allocate: vi.fn().mockResolvedValue(1) };
  const ledger = { recordOrderException: vi.fn().mockResolvedValue(undefined) };
  const service = new OrdersService(
    repo as never,
    outbox as never,
    audit as never,
    quotes as never,
    numbering as never,
    ledger as never,
  );
  return { service, repo, outbox, audit, quotes, numbering, ledger };
}

describe("OrdersService.create", () => {
  it("guards the quote, allocates a number, emits order.confirmed (IDs only) and audits", async () => {
    const { service, repo, outbox, audit, quotes, numbering } = makeService();
    const row = makeRow();
    repo.insert.mockResolvedValue(row);

    const result = await service.create(SCOPE, { quoteId: QUOTE_ID });

    expect(quotes.assertAcceptedForOrder).toHaveBeenCalledWith(SCOPE, QUOTE_ID);
    expect(numbering.allocate).toHaveBeenCalledWith(SCOPE, "order", YEAR);
    expect(repo.insert).toHaveBeenCalledWith(SCOPE, {
      quoteId: QUOTE_ID,
      orderNumber: `Z${YEAR}/0001`,
      status: "confirmed",
    });
    expect(outbox.emit).toHaveBeenCalledWith({
      aggregateType: "order",
      aggregateId: row.id,
      eventType: "order.confirmed",
      payload: { orderId: row.id }, // IDs ONLY — never PII
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "order.confirmed", entityId: row.id }),
    );
    expect(result.orderNumber).toBe(`Z${YEAR}/0001`);
    expect(result).not.toHaveProperty("ownerId");
  });

  it("checks the DEAL (the quote's revision chain) for a live order, excluding the quote itself", async () => {
    const { service, repo, quotes } = makeService();
    repo.insert.mockResolvedValue(makeRow());
    quotes.chainQuoteIds.mockResolvedValue([QUOTE_ID, REVISION_ID]);

    await service.create(SCOPE, { quoteId: QUOTE_ID });

    expect(quotes.chainQuoteIds).toHaveBeenCalledWith(SCOPE, QUOTE_ID);
    // The quote itself is deliberately excluded — a same-row duplicate stays the
    // `order_quote_active_uq` index's job (and its concurrency backstop).
    expect(repo.findLiveByQuoteIds).toHaveBeenCalledWith(SCOPE, [REVISION_ID]);
  });

  it("409s order_exists_for_chain when a sibling revision already has a live order", async () => {
    const { service, repo, quotes, numbering } = makeService();
    quotes.chainQuoteIds.mockResolvedValue([QUOTE_ID, REVISION_ID]);
    repo.findLiveByQuoteIds.mockResolvedValue(makeRow({ quoteId: REVISION_ID }));

    // Names the incumbent so the UI can offer RE-POINT instead of a second order
    // (ADR-O1). Asserted on the exception itself: `GlobalExceptionFilter` does
    // not yet forward `details` to the wire (flagged in ADR 0126), so the itest
    // can only check the code.
    await expect(service.create(SCOPE, { quoteId: QUOTE_ID })).rejects.toMatchObject({
      response: {
        code: "order_exists_for_chain",
        details: { orderId: ORDER_ID, orderNumber: `Z${YEAR}/0001`, quoteId: REVISION_ID },
      },
    });
    // Refused BEFORE a second gap-free number is burned.
    expect(numbering.allocate).not.toHaveBeenCalled();
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it("maps the order_quote_active_uq race to 409 order_exists", async () => {
    const { service, repo, outbox } = makeService();
    repo.insert.mockRejectedValue(
      Object.assign(new Error("dup"), { code: "23505", constraint: "order_quote_active_uq" }),
    );

    await expect(service.create(SCOPE, { quoteId: QUOTE_ID })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(outbox.emit).not.toHaveBeenCalled();
  });

  it("does not swallow an unrelated DB error", async () => {
    const { service, repo } = makeService();
    repo.insert.mockRejectedValue(Object.assign(new Error("boom"), { code: "42601" }));
    await expect(service.create(SCOPE, { quoteId: QUOTE_ID })).rejects.toThrow("boom");
  });

  it("propagates the guard rejection (quote not accepted) without inserting", async () => {
    const { service, repo, quotes } = makeService();
    quotes.assertAcceptedForOrder.mockRejectedValue(new ConflictException("nope"));
    await expect(service.create(SCOPE, { quoteId: QUOTE_ID })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(repo.insert).not.toHaveBeenCalled();
  });
});

describe("OrdersService transitions", () => {
  it("start moves confirmed → in_production, emits + audits", async () => {
    const { service, repo, outbox, audit } = makeService();
    repo.findById.mockResolvedValue(makeRow({ status: "confirmed" }));
    repo.setStatus.mockResolvedValue(makeRow({ status: "in_production" }));

    const result = await service.start(SCOPE, ORDER_ID);

    expect(repo.setStatus).toHaveBeenCalledWith(SCOPE, ORDER_ID, "in_production", undefined);
    expect(outbox.emit).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "order.production_started" }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "order.production_started" }),
    );
    expect(result.status).toBe("in_production");
  });

  it("start 409s from a non-confirmed order and emits nothing", async () => {
    const { service, repo, outbox } = makeService();
    repo.findById.mockResolvedValue(makeRow({ status: "completed" }));
    await expect(service.start(SCOPE, ORDER_ID)).rejects.toBeInstanceOf(ConflictException);
    expect(outbox.emit).not.toHaveBeenCalled();
  });

  it("repoint (from confirmed) guards the target, moves quoteId and audits before/after", async () => {
    const { service, repo, quotes, audit } = makeService();
    const NEW_QUOTE = "01890a5d-ac96-774b-bcce-b302099a0bbb";
    repo.findById.mockResolvedValue(makeRow({ status: "confirmed", quoteId: QUOTE_ID }));
    repo.repoint.mockResolvedValue(makeRow({ status: "confirmed", quoteId: NEW_QUOTE }));

    const result = await service.repoint(SCOPE, ORDER_ID, NEW_QUOTE);

    expect(quotes.assertRepointTarget).toHaveBeenCalledWith(SCOPE, QUOTE_ID, NEW_QUOTE);
    expect(repo.repoint).toHaveBeenCalledWith(SCOPE, ORDER_ID, NEW_QUOTE);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "order.repointed",
        diff: { before: { quoteId: QUOTE_ID }, after: { quoteId: NEW_QUOTE } },
      }),
    );
    expect(result.quoteId).toBe(NEW_QUOTE);
  });

  it("repoint 409s from a non-confirmed order (never touches the quote guard)", async () => {
    const { service, repo, quotes } = makeService();
    repo.findById.mockResolvedValue(makeRow({ status: "in_production" }));
    await expect(service.repoint(SCOPE, ORDER_ID, "x")).rejects.toBeInstanceOf(ConflictException);
    expect(quotes.assertRepointTarget).not.toHaveBeenCalled();
    expect(repo.repoint).not.toHaveBeenCalled();
  });

  it("cancel records the reason and audits before/after status", async () => {
    const { service, repo, audit } = makeService();
    repo.findById.mockResolvedValue(makeRow({ status: "in_production" }));
    repo.setStatus.mockResolvedValue(
      makeRow({ status: "cancelled", cancelReason: "customer pulled out" }),
    );

    const result = await service.cancel(SCOPE, ORDER_ID, "customer pulled out");

    expect(repo.setStatus).toHaveBeenCalledWith(
      SCOPE,
      ORDER_ID,
      "cancelled",
      "customer pulled out",
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "order.cancelled",
        diff: {
          before: { status: "in_production" },
          after: { status: "cancelled", cancelReason: "customer pulled out" },
        },
      }),
    );
    expect(result.cancelReason).toBe("customer pulled out");
  });
});

describe("OrdersService reads", () => {
  it("get 404s identically for missing and foreign rows (no oracle)", async () => {
    const { service, repo } = makeService();
    repo.findById.mockResolvedValue(null);
    await expect(service.get(SCOPE, "someone-elses")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("production resolves order → quote and delegates to QuotesService", async () => {
    const { service, repo, quotes } = makeService();
    repo.findById.mockResolvedValue(makeRow());
    quotes.getProductionByQuoteId.mockResolvedValue({ id: QUOTE_ID });

    await service.getProduction(SCOPE, ORDER_ID);

    expect(quotes.getProductionByQuoteId).toHaveBeenCalledWith(SCOPE, QUOTE_ID);
  });

  it("production 404s when the order is missing (before touching the quote)", async () => {
    const { service, repo, quotes } = makeService();
    repo.findById.mockResolvedValue(null);
    await expect(service.getProduction(SCOPE, "missing")).rejects.toBeInstanceOf(NotFoundException);
    expect(quotes.getProductionByQuoteId).not.toHaveBeenCalled();
  });
});
