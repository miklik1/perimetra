import { type TransactionHost } from "@nestjs-cls/transactional";
import { type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { ProjectsRepository } from "./projects.repository.js";

const SCOPE = { userId: "user-1", organizationId: "org-1" };
// UUIDv7s in creation order (cursor math relies on id ordering).
const ID_1 = "01890a5d-ac96-774b-bcce-b302099a0001";
const ID_2 = "01890a5d-ac96-774b-bcce-b302099a0002";
const ID_3 = "01890a5d-ac96-774b-bcce-b302099a0003";

const dialect = new PgDialect();
const render = (fragment: unknown) => dialect.sqlToQuery(fragment as SQL);

/**
 * Chainable drizzle mock: captures the WHERE/ORDER BY/LIMIT/VALUES/SET the
 * repository builds (real drizzle SQL objects — rendered for assertions)
 * and resolves with the given rows.
 */
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

  type TxHost = ConstructorParameters<typeof ProjectsRepository>[0];
  return { txHost: { tx } as unknown as TxHost, captured };
}

const row = (id: string) => ({ id, ownerId: SCOPE.userId });

describe("ProjectsRepository scope filtering (ADR 0041/0055)", () => {
  it("list filters by organization and excludes soft-deleted rows", async () => {
    const { txHost, captured } = makeTxHost([]);
    await new ProjectsRepository(txHost).list(SCOPE, { limit: 20, sort: "createdAt:desc" });

    const { sql, params } = render(captured.where);
    expect(sql).toContain('"organization_id"');
    expect(sql.toLowerCase()).toContain('"deleted_at" is null');
    expect(params).toContain(SCOPE.organizationId);
  });

  it("findById, update and softDelete all carry the org scope filter", async () => {
    for (const exercise of [
      (repo: ProjectsRepository) => repo.findById(SCOPE, ID_1),
      (repo: ProjectsRepository) => repo.update(SCOPE, ID_1, { name: "x" }),
      (repo: ProjectsRepository) => repo.softDelete(SCOPE, ID_1),
    ]) {
      const { txHost, captured } = makeTxHost([]);
      await exercise(new ProjectsRepository(txHost));

      const { sql, params } = render(captured.where);
      expect(sql).toContain('"organization_id"');
      expect(sql.toLowerCase()).toContain('"deleted_at" is null');
      expect(params).toEqual(expect.arrayContaining([SCOPE.organizationId, ID_1]));
    }
  });

  it("insert stamps ownerId (audit) and organizationId (scope)", async () => {
    const { txHost, captured } = makeTxHost([row(ID_1)]);
    await new ProjectsRepository(txHost).insert(
      { userId: "user-1", organizationId: "org-1" },
      { name: "Skeleton" },
    );

    expect(captured.values).toMatchObject({
      ownerId: "user-1",
      organizationId: "org-1",
      name: "Skeleton",
      description: null,
    });
  });

  it("softDelete sets deletedAt (tombstone, never DELETE) and reports hits", async () => {
    const hit = makeTxHost([{ id: ID_1 }]);
    await expect(new ProjectsRepository(hit.txHost).softDelete(SCOPE, ID_1)).resolves.toBe(true);
    expect(hit.captured.set?.["deletedAt"]).toBeInstanceOf(Date);

    const miss = makeTxHost([]);
    await expect(new ProjectsRepository(miss.txHost).softDelete(SCOPE, ID_1)).resolves.toBe(false);
  });
});

describe("ProjectsRepository keyset pagination", () => {
  it("fetches limit+1 and turns the extra row into nextCursor", async () => {
    const { txHost, captured } = makeTxHost([row(ID_3), row(ID_2), row(ID_1)]);
    const page = await new ProjectsRepository(txHost).list(SCOPE, {
      limit: 2,
      sort: "createdAt:desc",
    });

    expect(captured.limit).toBe(3);
    expect(page.items.map((r) => r.id)).toEqual([ID_3, ID_2]);
    // Cursor = last RETURNED row, not the peeked one.
    expect(page.nextCursor).toBe(ID_2);
  });

  it("returns nextCursor null on the last page", async () => {
    const { txHost } = makeTxHost([row(ID_2), row(ID_1)]);
    const page = await new ProjectsRepository(txHost).list(SCOPE, {
      limit: 2,
      sort: "createdAt:desc",
    });
    expect(page.nextCursor).toBeNull();
  });

  it("desc pages with id < cursor, desc ordering", async () => {
    const { txHost, captured } = makeTxHost([]);
    await new ProjectsRepository(txHost).list(SCOPE, {
      limit: 20,
      sort: "createdAt:desc",
      cursor: ID_2,
    });

    const { sql, params } = render(captured.where);
    expect(sql).toMatch(/"id" </);
    expect(params).toContain(ID_2);
    expect(render(captured.orderBy).sql.toLowerCase()).toContain("desc");
  });

  it("asc pages with id > cursor, asc ordering", async () => {
    const { txHost, captured } = makeTxHost([]);
    await new ProjectsRepository(txHost).list(SCOPE, {
      limit: 20,
      sort: "createdAt:asc",
      cursor: ID_2,
    });

    const { sql } = render(captured.where);
    expect(sql).toMatch(/"id" >/);
    expect(render(captured.orderBy).sql.toLowerCase()).toContain("asc");
  });

  it("applies the status filter only when asked", async () => {
    const filtered = makeTxHost([]);
    await new ProjectsRepository(filtered.txHost).list(SCOPE, {
      limit: 20,
      sort: "createdAt:desc",
      status: "archived",
    });
    expect(render(filtered.captured.where).params).toContain("archived");

    const unfiltered = makeTxHost([]);
    await new ProjectsRepository(unfiltered.txHost).list(SCOPE, {
      limit: 20,
      sort: "createdAt:desc",
    });
    expect(render(unfiltered.captured.where).sql).not.toContain('"status"');
  });
});

// Type-level guard: the repository must accept the real TransactionHost shape.
void (undefined as unknown as TransactionHost);
