/**
 * OrdersService unit tests (ADR 0109 / ADR-O1) — the orchestration: the
 * accepted-quote guard, gap-free number allocation, the IDs-only outbox event +
 * audit row in one tx, the state-machine guards, the `order_quote_active_uq`
 * race → 409, and the production re-home delegating to `QuotesService`. Live
 * DB behavior (the partial-unique race, gap-free numbering) is proven in
 * `apps/api/test/orders.itest.ts`.
 */
import { ConflictException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { type OrderRow } from "@repo/db/schema/orders";

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
const ORDER_ID = "01890a5d-ac96-774b-bcce-b302099a0001";

function makeRow(overrides: Partial<OrderRow> = {}): OrderRow {
  return {
    id: ORDER_ID,
    ownerId: SCOPE.userId,
    organizationId: SCOPE.organizationId,
    quoteId: QUOTE_ID,
    orderNumber: "Z2026/0001",
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
    insert: vi.fn(),
    setStatus: vi.fn(),
  };
  const outbox = { emit: vi.fn().mockResolvedValue("event-id") };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const quotes = {
    assertAcceptedForOrder: vi.fn().mockResolvedValue(undefined),
    getProductionByQuoteId: vi.fn(),
  };
  const numbering = { allocate: vi.fn().mockResolvedValue(1) };
  const service = new OrdersService(
    repo as never,
    outbox as never,
    audit as never,
    quotes as never,
    numbering as never,
  );
  return { service, repo, outbox, audit, quotes, numbering };
}

describe("OrdersService.create", () => {
  it("guards the quote, allocates a number, emits order.confirmed (IDs only) and audits", async () => {
    const { service, repo, outbox, audit, quotes, numbering } = makeService();
    const row = makeRow();
    repo.insert.mockResolvedValue(row);

    const result = await service.create(SCOPE, { quoteId: QUOTE_ID });

    expect(quotes.assertAcceptedForOrder).toHaveBeenCalledWith(SCOPE, QUOTE_ID);
    expect(numbering.allocate).toHaveBeenCalledWith(SCOPE, "order", 2026);
    expect(repo.insert).toHaveBeenCalledWith(SCOPE, {
      quoteId: QUOTE_ID,
      orderNumber: "Z2026/0001",
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
    expect(result.orderNumber).toBe("Z2026/0001");
    expect(result).not.toHaveProperty("ownerId");
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
