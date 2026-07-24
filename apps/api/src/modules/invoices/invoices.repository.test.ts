/**
 * Repository unit test (chainable drizzle mock, no DB) — proves every query
 * carries the org `scoped()` seam (ADR 0041) PLUS the per-rep ownership
 * narrowing (ADR 0082), the keyset cursor math, and the CONDITIONAL
 * mark-paid/unmark-paid guards (status in the WHERE, not a read). An invoice is
 * immutable: there is no soft-delete filter and no update path.
 */
import { type TransactionHost } from "@nestjs-cls/transactional";
import { type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { InvoicesRepository, type InsertInvoiceData } from "./invoices.repository.js";

const SCOPE = { userId: "user-1", organizationId: "org-1" };
/** admin — the whole org. */
const ORG_WIDE = { restrictToOwner: false };
/** a non-admin rep — narrowed to its own invoices (ADR 0082). */
const OWN_ONLY = { restrictToOwner: true };
const ID_1 = "01890a5d-ac96-774b-bcce-b302099a0001";
const ID_2 = "01890a5d-ac96-774b-bcce-b302099a0002";
const ID_3 = "01890a5d-ac96-774b-bcce-b302099a0003";

const dialect = new PgDialect();
const render = (fragment: unknown) => dialect.sqlToQuery(fragment as SQL);

function makeTxHost(rows: unknown[] = []) {
  const captured: {
    where?: SQL;
    orderBy?: SQL;
    limit?: number;
    values?: Record<string, unknown>;
    set?: Record<string, unknown>;
  } = {};

  const terminal = Promise.resolve(rows);
  const limit = (n: number) => {
    captured.limit = n;
    return terminal;
  };
  const orderBy = (o: SQL) => {
    captured.orderBy = o;
    return { limit };
  };
  const where = (w: SQL) => {
    captured.where = w;
    return { orderBy, limit, returning: () => terminal };
  };
  const tx = {
    select: () => ({ from: () => ({ where }) }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        captured.values = v;
        return { returning: () => terminal };
      },
    }),
    update: () => ({
      set: (s: Record<string, unknown>) => {
        captured.set = s;
        return { where };
      },
    }),
  };

  type TxHost = ConstructorParameters<typeof InvoicesRepository>[0];
  return { txHost: { tx } as unknown as TxHost, captured };
}

const row = (id: string) => ({ id, ownerId: SCOPE.userId });

const insertData: InsertInvoiceData = {
  id: ID_1,
  orderId: "order-1",
  documentNumber: "FV2026/0007",
  status: "issued",
  currency: "CZK",
  issuedOn: "2026-07-16",
  duzp: "2026-07-16",
  dueOn: "2026-07-30",
  variableSymbol: "20260007",
  totalMoney: "121000.00",
  facts: { id: ID_1 },
  snapshot: { id: ID_1 },
};

describe("InvoicesRepository scope filtering (ADR 0041 org + ADR 0082 owner)", () => {
  it("list filters by organization (no deleted_at — invoices are never soft-deleted)", async () => {
    const { txHost, captured } = makeTxHost([]);
    await new InvoicesRepository(txHost).list(SCOPE, ORG_WIDE, {
      limit: 20,
      sort: "createdAt:desc",
    });

    const { sql, params } = render(captured.where);
    expect(sql).toContain('"organization_id"');
    expect(sql.toLowerCase()).not.toContain("deleted_at");
    expect(params).toContain(SCOPE.organizationId);
  });

  it("findById carries the org scope", async () => {
    const { txHost, captured } = makeTxHost([]);
    await new InvoicesRepository(txHost).findById(SCOPE, ORG_WIDE, ID_1);
    const { sql, params } = render(captured.where);
    expect(sql).toContain('"organization_id"');
    expect(params).toEqual(expect.arrayContaining([SCOPE.organizationId, ID_1]));
  });

  it("restrictToOwner ADDS owner_id to every read — it never replaces the org filter", async () => {
    // The PII flank (ADR 0082): the buyer's §29 identity lives in facts/snapshot,
    // so "same org" is not a tight enough boundary for a non-admin rep.
    for (const exercise of [
      (r: InvoicesRepository) => r.list(SCOPE, OWN_ONLY, { limit: 20, sort: "createdAt:desc" }),
      (r: InvoicesRepository) => r.findById(SCOPE, OWN_ONLY, ID_1),
      (r: InvoicesRepository) => r.markPaid(SCOPE, OWN_ONLY, ID_1, new Date(), null),
      (r: InvoicesRepository) => r.unmarkPaid(SCOPE, OWN_ONLY, ID_1),
    ]) {
      const { txHost, captured } = makeTxHost([row(ID_1)]);
      await exercise(new InvoicesRepository(txHost));
      const { sql, params } = render(captured.where);
      expect(sql).toContain('"organization_id"');
      expect(sql).toContain('"owner_id"');
      expect(params).toEqual(expect.arrayContaining([SCOPE.organizationId, SCOPE.userId]));
    }
  });

  it("admin (restrictToOwner false) emits NO owner_id predicate", async () => {
    const { txHost, captured } = makeTxHost([]);
    await new InvoicesRepository(txHost).list(SCOPE, ORG_WIDE, {
      limit: 20,
      sort: "createdAt:desc",
    });
    expect(render(captured.where).sql).not.toContain('"owner_id"');
  });

  it("findByIdSystem stays scope-less — the worker re-fetches from an IDs-only payload", async () => {
    // ADR 0037: the outbox handler has no request scope and no role. Narrowing it
    // would silently drop realtime pushes for every rep's invoice but the issuer's.
    const { txHost, captured } = makeTxHost([row(ID_1)]);
    await new InvoicesRepository(txHost).findByIdSystem(ID_1);
    const { sql } = render(captured.where);
    expect(sql).not.toContain('"organization_id"');
    expect(sql).not.toContain('"owner_id"');
  });

  it("markPaid / unmarkPaid guard on status inside the WHERE (race-safe)", async () => {
    for (const [exercise, status] of [
      [(r: InvoicesRepository) => r.markPaid(SCOPE, ORG_WIDE, ID_1, new Date(), null), "issued"],
      [(r: InvoicesRepository) => r.unmarkPaid(SCOPE, ORG_WIDE, ID_1), "paid"],
    ] as const) {
      const { txHost, captured } = makeTxHost([row(ID_1)]);
      await exercise(new InvoicesRepository(txHost));
      const { sql, params } = render(captured.where);
      expect(sql).toContain('"organization_id"');
      expect(sql).toContain('"status"');
      expect(params).toEqual(expect.arrayContaining([SCOPE.organizationId, ID_1, status]));
    }
  });

  it("insert stamps ownerId (audit) and organizationId (scope)", async () => {
    const { txHost, captured } = makeTxHost([row(ID_1)]);
    await new InvoicesRepository(txHost).insert(SCOPE, insertData);
    expect(captured.values).toMatchObject({
      ownerId: SCOPE.userId,
      organizationId: SCOPE.organizationId,
      documentNumber: "FV2026/0007",
      status: "issued",
    });
  });
});

describe("InvoicesRepository keyset pagination", () => {
  it("fetches limit+1 and turns the extra row into nextCursor", async () => {
    const { txHost, captured } = makeTxHost([row(ID_3), row(ID_2), row(ID_1)]);
    const page = await new InvoicesRepository(txHost).list(SCOPE, ORG_WIDE, {
      limit: 2,
      sort: "createdAt:desc",
    });
    expect(captured.limit).toBe(3);
    expect(page.items.map((r) => r.id)).toEqual([ID_3, ID_2]);
    expect(page.nextCursor).toBe(ID_2);
  });

  it("returns nextCursor null on the last page", async () => {
    const { txHost } = makeTxHost([row(ID_2), row(ID_1)]);
    const page = await new InvoicesRepository(txHost).list(SCOPE, ORG_WIDE, {
      limit: 2,
      sort: "createdAt:desc",
    });
    expect(page.nextCursor).toBeNull();
  });
});

void (undefined as unknown as TransactionHost);
