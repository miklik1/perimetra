/**
 * LedgerService unit tests (ADR 0110 / ADR-O4, CAR-159) — the query path maps
 * `quote_override` rows through the engine's pure `recurrenceReport`, and the
 * record/rebuild paths delegate to the repository correctly. Live projection
 * behavior is proven in `apps/api/test/ledger.itest.ts`.
 */
import { describe, expect, it, vi } from "vitest";

import { LedgerService } from "./ledger.service.js";

vi.mock("@nestjs-cls/transactional", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@nestjs-cls/transactional")>()),
  Transactional: () => () => undefined,
}));

const SCOPE = { userId: "u1", organizationId: "o1" };
const NOW = new Date("2026-01-01T00:00:00.000Z");

const row = (over: Record<string, unknown> = {}) => ({
  id: "01890a5d-ac96-774b-bcce-b302099a0001",
  quoteId: "q1",
  orderId: null,
  source: "quote_override",
  kind: "param",
  target: "param:width",
  value: 3200,
  reason: "custom",
  actorId: null,
  createdAt: NOW,
  ...over,
});

function make() {
  const repo = {
    insertMany: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([]),
    findQuoteOverrides: vi.fn().mockResolvedValue([]),
    deleteQuoteOverrides: vi.fn().mockResolvedValue(undefined),
  };
  return { service: new LedgerService(repo as never), repo };
}

describe("LedgerService.query", () => {
  it("returns the page + a recurrence report over quote_override rows", async () => {
    const { service, repo } = make();
    repo.list.mockResolvedValue([row({ id: "a" }), row({ id: "b", quoteId: "q2" })]);
    repo.findQuoteOverrides.mockResolvedValue([
      row({ id: "a", quoteId: "q1" }),
      row({ id: "b", quoteId: "q2" }),
    ]);

    const page = await service.query(SCOPE as never, { limit: 50 } as never);

    expect(page.items).toHaveLength(2);
    // Both hit param:width across two distinct quotes → one recurrence group.
    expect(page.recurrence).toHaveLength(1);
    expect(page.recurrence[0]).toMatchObject({
      target: "param:width",
      occurrences: 2,
      distinctQuotes: 2,
    });
  });

  it("computes nextCursor from the peeked (limit+1) row", async () => {
    const { service, repo } = make();
    repo.list.mockResolvedValue([row({ id: "a" }), row({ id: "b" }), row({ id: "c" })]);
    const page = await service.query(SCOPE as never, { limit: 2 } as never);
    expect(page.items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(page.nextCursor).toBe("b");
  });
});

describe("LedgerService.record*", () => {
  it("recordOrderException inserts one order_exception row", async () => {
    const { service, repo } = make();
    await service.recordOrderException(
      SCOPE as never,
      { quoteId: "q1", orderId: "ord1", reason: "swapped material" },
      "u1",
    );
    expect(repo.insertMany).toHaveBeenCalledWith(SCOPE, [
      expect.objectContaining({
        quoteId: "q1",
        orderId: "ord1",
        source: "order_exception",
        reason: "swapped material",
        actorId: "u1",
      }),
    ]);
  });

  it("rebuildQuoteOverrides clears then re-projects and returns the count", async () => {
    const { service, repo } = make();
    const projected = await service.rebuildQuoteOverrides(SCOPE as never, [
      {
        quoteId: "q1",
        snapshot: { inputs: { gate: { overrides: { quote: [] } } } },
      },
    ]);
    expect(repo.deleteQuoteOverrides).toHaveBeenCalledWith(SCOPE);
    expect(projected).toBe(0);
  });
});
