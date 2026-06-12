/**
 * Migration gate (spec §6/§14): the globalSetup already applied the FULL
 * chain from `packages/db/migrations` to the EMPTY Postgres 17 container —
 * a chain that fails to apply kills the whole run before any test. This
 * file asserts the rest of the gate:
 *
 * 1. every migration on disk is recorded as applied (none skipped/failed),
 * 2. re-running the migrator is a no-op (the journal is consistent),
 * 3. the live table inventory matches the `@repo/db/schema` exports.
 *
 * HONESTY NOTE on the drift gate: the spec asks for a drizzle-kit
 * introspection diff. drizzle-kit 1.0.0-rc ships no reliable
 * NON-INTERACTIVE diff surface — `generate`/`push` are interactive on
 * ambiguity, and the programmatic API (`drizzle-kit/api`) is unstable in
 * the rc line. Until it stabilizes, the drift gate here is deliberately
 * coarser: full-chain-applies-cleanly (globalSetup) + the table-inventory
 * comparison below. That catches added/removed/renamed TABLES but NOT
 * column-level drift inside a table; tighten to a real introspection diff
 * when drizzle-kit 1.0 finalizes its API.
 */
import { readdirSync } from "node:fs";
import { getTableName, is } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { PgTable } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrationsFolder } from "@repo/db/migrations-path";
import * as schema from "@repo/db/schema";

describe("migration gate (fresh Postgres 17 container)", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  });

  afterAll(async () => {
    await pool.end();
  });

  function migrationDirsOnDisk(): string[] {
    return readdirSync(migrationsFolder, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  }

  async function appliedMigrationCount(): Promise<number> {
    // drizzle's node-postgres migrator journals into drizzle.__drizzle_migrations.
    const result = await pool.query<{ count: string }>(
      'select count(*)::text as count from "drizzle"."__drizzle_migrations"',
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  it("recorded every migration on disk as applied", async () => {
    const dirs = migrationDirsOnDisk();
    expect(dirs.length).toBeGreaterThan(0);
    expect(await appliedMigrationCount()).toBe(dirs.length);
  });

  it("re-running the migrator is a no-op", async () => {
    const before = await appliedMigrationCount();
    await migrate(drizzle({ client: pool }), { migrationsFolder });
    expect(await appliedMigrationCount()).toBe(before);
  });

  it("table inventory matches the @repo/db/schema exports exactly", async () => {
    // `as unknown[]`: the barrel exports tables AND helper consts; the `is()`
    // type predicate needs a widened input to narrow from.
    const expected = (Object.values(schema) as unknown[])
      .filter((value): value is PgTable => is(value, PgTable))
      .map((table) => getTableName(table))
      .sort();
    expect(expected.length).toBeGreaterThan(0);

    const result = await pool.query<{ table_name: string }>(
      `select table_name
         from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'`,
    );
    const actual = result.rows.map((row) => row.table_name).sort();

    // One assertion, both directions: a table in code but not in the chain
    // (forgotten `db:generate`) or in the chain but not in code (orphan)
    // fails identically.
    expect(actual).toEqual(expected);
  });
});
