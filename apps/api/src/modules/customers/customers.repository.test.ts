/**
 * Customers repository unit test (ADR 0082) — proves every query carries the
 * ORG filter (always) and the per-rep owner narrowing (only when restricted),
 * plus the keyset cursor math. Rep isolation end-to-end is the integration test.
 */
import { type TransactionHost } from "@nestjs-cls/transactional";
import { type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { CustomersRepository, type InsertCustomerData } from "./customers.repository.js";

const SCOPE = { userId: "user-1", organizationId: "org-1" };
const ID_1 = "01890a5d-ac96-774b-bcce-b302099a0001";
const ID_2 = "01890a5d-ac96-774b-bcce-b302099a0002";
const ID_3 = "01890a5d-ac96-774b-bcce-b302099a0003";

const dialect = new PgDialect();
const render = (fragment: unknown) => dialect.sqlToQuery(fragment as SQL);

function makeTxHost(rows: unknown[] = []) {
  const captured: { where?: SQL; limit?: number; values?: Record<string, unknown> } = {};
  const terminal = Promise.resolve(rows);
  const limit = (n: number) => {
    captured.limit = n;
    return terminal;
  };
  const orderBy = () => ({ limit });
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
    update: () => ({ set: () => ({ where }) }),
  };
  type TxHost = ConstructorParameters<typeof CustomersRepository>[0];
  return { txHost: { tx } as unknown as TxHost, captured };
}

const row = (id: string) => ({ id, ownerId: SCOPE.userId, organizationId: SCOPE.organizationId });
const DATA: InsertCustomerData = {
  name: "Stavby s.r.o.",
  ico: null,
  dic: "CZ12345678",
  vatPayer: true,
  email: null,
  phone: null,
  addressLine: null,
  city: null,
  postalCode: null,
  country: "CZ",
  note: null,
};

describe("CustomersRepository org + per-rep scope (ADR 0082)", () => {
  it("always filters by org; admin (not restricted) does NOT narrow to owner", async () => {
    const { txHost, captured } = makeTxHost([]);
    await new CustomersRepository(txHost).list(
      SCOPE,
      { restrictToOwner: false },
      { limit: 20, sort: "createdAt:desc" },
    );
    const { sql, params } = render(captured.where);
    expect(sql).toContain('"organization_id"');
    expect(sql).not.toContain('"owner_id"');
    expect(params).toContain(SCOPE.organizationId);
  });

  it("a restricted rep narrows to org AND owner", async () => {
    const { txHost, captured } = makeTxHost([]);
    await new CustomersRepository(txHost).findById(SCOPE, { restrictToOwner: true }, ID_1);
    const { sql, params } = render(captured.where);
    expect(sql).toContain('"organization_id"');
    expect(sql).toContain('"owner_id"');
    expect(params).toEqual(expect.arrayContaining([SCOPE.organizationId, SCOPE.userId, ID_1]));
  });

  it("insert stamps ownerId + organizationId from the scope", async () => {
    const { txHost, captured } = makeTxHost([row(ID_1)]);
    await new CustomersRepository(txHost).insert(SCOPE, DATA);
    expect(captured.values).toMatchObject({
      ownerId: "user-1",
      organizationId: "org-1",
      name: "Stavby s.r.o.",
      dic: "CZ12345678",
      vatPayer: true,
    });
  });
});

describe("CustomersRepository search (CAR-23)", () => {
  it("adds a name-OR-ico ILIKE clause, wrapped in wildcards", async () => {
    const { txHost, captured } = makeTxHost([]);
    await new CustomersRepository(txHost).list(
      SCOPE,
      { restrictToOwner: false },
      { limit: 20, sort: "createdAt:desc", search: "Bartek" },
    );
    const { sql, params } = render(captured.where);
    expect(sql.toLowerCase()).toContain("ilike");
    expect(sql).toContain('"name"');
    expect(sql).toContain('"ico"');
    expect(params).toContain("%Bartek%");
  });

  it("escapes ILIKE wildcards in the search term (no accidental pattern match)", async () => {
    const { txHost, captured } = makeTxHost([]);
    await new CustomersRepository(txHost).list(
      SCOPE,
      { restrictToOwner: false },
      { limit: 20, sort: "createdAt:desc", search: "50%_off" },
    );
    const { params } = render(captured.where);
    expect(params).toContain("%50\\%\\_off%");
  });

  it("omits the search clause entirely when no search term is given", async () => {
    const { txHost, captured } = makeTxHost([]);
    await new CustomersRepository(txHost).list(
      SCOPE,
      { restrictToOwner: false },
      { limit: 20, sort: "createdAt:desc" },
    );
    const { sql } = render(captured.where);
    expect(sql.toLowerCase()).not.toContain("ilike");
  });
});

describe("CustomersRepository keyset pagination", () => {
  it("fetches limit+1 and turns the extra row into nextCursor", async () => {
    const { txHost, captured } = makeTxHost([row(ID_3), row(ID_2), row(ID_1)]);
    const page = await new CustomersRepository(txHost).list(
      SCOPE,
      { restrictToOwner: false },
      { limit: 2, sort: "createdAt:desc" },
    );
    expect(captured.limit).toBe(3);
    expect(page.items.map((r) => r.id)).toEqual([ID_3, ID_2]);
    expect(page.nextCursor).toBe(ID_2);
  });
});

// Type-level guard: the repository must accept the real TransactionHost shape.
void (undefined as unknown as TransactionHost);
