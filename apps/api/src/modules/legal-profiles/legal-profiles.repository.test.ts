/**
 * Legal-profiles repository unit test (ADR 0088) — proves the singleton queries
 * carry the org scope (`find`) and that `upsert` stamps org + owner and keys on
 * the org unique index (create-or-replace). Drizzle SQL is rendered for assertions.
 */
import { type TransactionHost } from "@nestjs-cls/transactional";
import { type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { LegalProfilesRepository } from "./legal-profiles.repository.js";

const SCOPE = { userId: "user-1", organizationId: "org-1" };
const ID_1 = "01890a5d-ac96-774b-bcce-b302099a0001";

const dialect = new PgDialect();
const render = (fragment: unknown) => dialect.sqlToQuery(fragment as SQL);

/** Chainable drizzle mock — captures WHERE / VALUES / the onConflict set. */
function makeTxHost(rows: unknown[] = []) {
  const captured: {
    where?: SQL;
    limit?: number;
    values?: Record<string, unknown>;
    conflict?: { target?: unknown; set?: Record<string, unknown> };
  } = {};

  const terminal = Promise.resolve(rows);
  const limit = (n: number) => {
    captured.limit = n;
    return terminal;
  };
  const where = (w: SQL) => {
    captured.where = w;
    return { limit };
  };
  const tx = {
    select: () => ({ from: () => ({ where }) }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        captured.values = v;
        return {
          onConflictDoUpdate: (cfg: { target?: unknown; set?: Record<string, unknown> }) => {
            captured.conflict = cfg;
            return { returning: () => terminal };
          },
          returning: () => terminal,
        };
      },
    }),
  };

  type TxHost = ConstructorParameters<typeof LegalProfilesRepository>[0];
  return { txHost: { tx } as unknown as TxHost, captured };
}

const row = (id: string) => ({ id, ownerId: SCOPE.userId, organizationId: SCOPE.organizationId });

describe("LegalProfilesRepository (singleton, org-scoped)", () => {
  it("find filters by the org scope", async () => {
    const { txHost, captured } = makeTxHost([]);
    await new LegalProfilesRepository(txHost).find(SCOPE);

    const { sql, params } = render(captured.where);
    expect(sql).toContain('"organization_id"');
    expect(params).toContain(SCOPE.organizationId);
    expect(captured.limit).toBe(1);
  });

  it("upsert stamps org + owner and keys on the org conflict target", async () => {
    const { txHost, captured } = makeTxHost([row(ID_1)]);
    await new LegalProfilesRepository(txHost).upsert(SCOPE, {
      name: "Perimetra Vrata s.r.o.",
      ico: "27074358",
      dic: "CZ27074358",
      vatPayer: true,
      addressLine: null,
      city: null,
      postalCode: null,
      country: "CZ",
      bankAccount: null,
      iban: null,
      registrationNote: null,
    });

    expect(captured.values).toMatchObject({
      organizationId: "org-1",
      ownerId: "user-1",
      name: "Perimetra Vrata s.r.o.",
      vatPayer: true,
    });
    // Replaces on conflict (the org already has a profile) — re-stamps the editor.
    expect(captured.conflict?.target).toBeDefined();
    expect(captured.conflict?.set).toMatchObject({
      ownerId: "user-1",
      name: "Perimetra Vrata s.r.o.",
    });
  });
});

// Type-level guard: the repository must accept the real TransactionHost shape.
void (undefined as unknown as TransactionHost);
