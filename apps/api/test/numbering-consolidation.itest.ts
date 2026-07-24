/**
 * O2-a numbering consolidation (ADR 0112 §3) at the HTTP + migration layer
 * against the real containers. Proves the three acceptance properties the ADR
 * names:
 *
 * 1. issued quote numbers stay BYTE-IDENTICAL (`{year}/{seq:04d}`) and GAP-FREE
 *    after the counter's home moved from `quote_number_sequence` to the shared
 *    `document_number_sequence` ('quote' series) — and the legacy table is no
 *    longer written by the switched code;
 * 2. the shipped backfill migration COPIES every legacy counter across,
 *    preserving `last_number`;
 * 3. the backfill is IDEMPOTENT and never REGRESSES a counter the switched code
 *    may already have advanced (`ON CONFLICT DO NOTHING`).
 *
 * Tests 2/3 execute the ACTUAL migration SQL read from disk (no inline copy, so
 * the assertion can't drift from what ships).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type NestFastifyApplication } from "@nestjs/platform-fastify";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Db } from "@repo/db";
import { migrationsFolder } from "@repo/db/migrations-path";
import { documentNumberSequence } from "@repo/db/schema/numbering";
import { quoteNumberSequence } from "@repo/db/schema/quotes";
import {
  siteCosts,
  siteFenceConfig,
  siteGateConfig,
  sitePrices,
  steppedSite,
} from "@repo/fixtures";

import { DB } from "../src/common/db/db.module.js";
import { numberingYear } from "../src/modules/numbering/numbering-year.js";
import {
  createApiApp,
  createBuyerFor,
  inject,
  orgIdOf,
  seedGoldenCorpusFor,
  signUpUser,
  type TestUser,
} from "./setup/app.js";

/** The issue body MINUS the buyer — an odběratel is mandatory at issue since
 *  ADR 0126, so `beforeAll` folds this org's own customer in (`issueBody`). */
const baseIssueBody = {
  site: steppedSite,
  instances: [
    { instanceId: "gate", releaseId: "sliding-gate@1", input: siteGateConfig },
    { instanceId: "fenceA", releaseId: "fence-run@1", input: siteFenceConfig },
    { instanceId: "fenceB", releaseId: "fence-run@1", input: siteFenceConfig },
  ],
};

const priceTableBody = {
  currency: "CZK",
  effectiveFrom: "2026-01-01T00:00:00.000Z",
  dphRate: "21",
  table: sitePrices,
  cost: siteCosts,
};

/** The exact backfill SQL that ships in the O2-a migration (read from disk). */
function consolidationMigrationSql(): string {
  const dir = readdirSync(migrationsFolder).find((name) =>
    name.endsWith("_consolidate_quote_numbering"),
  );
  if (!dir) throw new Error("O2-a consolidation migration folder not found on disk");
  return readFileSync(join(migrationsFolder, dir, "migration.sql"), "utf8");
}

describe("numbering consolidation (HTTP + migration, real stack) — O2-a / ADR 0112 §3", () => {
  let app: NestFastifyApplication;
  let db: Db;
  let tenant: TestUser;
  let orgId: string;
  /** `baseIssueBody` + this org's odběratel (mandatory since ADR 0126). */
  let issueBody: Record<string, unknown>;

  const post = (user: TestUser, url: string, payload?: Record<string, unknown>) =>
    inject(app, { method: "POST", url, headers: { cookie: user.cookie }, payload: payload ?? {} });

  beforeAll(async () => {
    app = await createApiApp();
    db = app.get<Db>(DB);
    tenant = await signUpUser(app, "numbering-tenant");
    orgId = await orgIdOf(db, tenant.id);
    await seedGoldenCorpusFor(app, db, tenant);
    expect((await post(tenant, "/v1/price-tables", priceTableBody)).statusCode).toBe(201);
    issueBody = { ...baseIssueBody, customerId: await createBuyerFor(app, tenant) };
  });

  afterAll(async () => {
    await app.close();
  });

  it("issues byte-identical, gap-free quote numbers from the shared 'quote' series", async () => {
    const year = numberingYear();
    const numbers: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await post(tenant, "/v1/quotes", issueBody);
      expect(res.statusCode).toBe(201);
      numbers.push((res.json() as { documentNumber: string }).documentNumber);
    }

    // Byte-identical format + gap-free sequence (the legal series is unchanged).
    expect(numbers).toEqual([`${year}/0001`, `${year}/0002`, `${year}/0003`]);

    // Sourced from the shared allocator: `document_number_sequence` now carries
    // the 'quote' counter at 3 …
    const [shared] = await db
      .select({ lastNumber: documentNumberSequence.lastNumber })
      .from(documentNumberSequence)
      .where(
        and(
          eq(documentNumberSequence.organizationId, orgId),
          eq(documentNumberSequence.series, "quote"),
          eq(documentNumberSequence.year, year),
        ),
      );
    expect(shared?.lastNumber).toBe(3);

    // … and the legacy per-org counter is NO LONGER WRITTEN by the switched code.
    const legacy = await db
      .select()
      .from(quoteNumberSequence)
      .where(eq(quoteNumberSequence.organizationId, orgId));
    expect(legacy).toHaveLength(0);
  });

  it("backfill copies legacy counters across, idempotently and without regressing", async () => {
    const backfillYear = 2019; // distinct from the live-issue year (no collision)
    const migrationSql = consolidationMigrationSql();

    // A pre-consolidation counter that an org accrued on the OLD code path.
    await db
      .insert(quoteNumberSequence)
      .values({ organizationId: orgId, year: backfillYear, lastNumber: 7 });

    // (2) copies it across, preserving last_number.
    await db.execute(sql.raw(migrationSql));
    const afterFirst = await readSharedQuote(db, orgId, backfillYear);
    expect(afterFirst).toBe(7);

    // (3a) idempotent — a re-run does not change it.
    await db.execute(sql.raw(migrationSql));
    expect(await readSharedQuote(db, orgId, backfillYear)).toBe(7);

    // (3b) never regresses — if the switched code already advanced the shared
    // counter past the legacy value, ON CONFLICT DO NOTHING leaves it ahead.
    await db
      .update(documentNumberSequence)
      .set({ lastNumber: 9 })
      .where(
        and(
          eq(documentNumberSequence.organizationId, orgId),
          eq(documentNumberSequence.series, "quote"),
          eq(documentNumberSequence.year, backfillYear),
        ),
      );
    await db.execute(sql.raw(migrationSql));
    expect(await readSharedQuote(db, orgId, backfillYear)).toBe(9);
  });
});

async function readSharedQuote(db: Db, orgId: string, year: number): Promise<number | undefined> {
  const [row] = await db
    .select({ lastNumber: documentNumberSequence.lastNumber })
    .from(documentNumberSequence)
    .where(
      and(
        eq(documentNumberSequence.organizationId, orgId),
        eq(documentNumberSequence.series, "quote"),
        eq(documentNumberSequence.year, year),
      ),
    );
  return row?.lastNumber;
}
