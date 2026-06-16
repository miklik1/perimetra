/**
 * Seed entrypoint — publishes the golden corpus into the DB via the existing
 * publish services (admin-publish slice, WS4). Runs AFTER migrations.
 *
 * Idempotent: each publish call is wrapped in a try/catch that silently skips
 * ConflictException (409) — re-running is always safe.
 *
 * Catalog versions + releases are global vendor data (no org scope).
 * Price tables are per-org: we query every org that lacks a price-table row at
 * `sitePrices.version` and publish one using that org's owner's userId.
 *
 * @repo/fixtures is a dev-bootstrap-only runtime dep of this file — the one
 * legitimate api-side fixtures consumer (the ESLint package boundary already
 * permits app → fixtures; knip sees the import via the `src/seed.ts` entry in
 * knip.json).
 */
import "reflect-metadata";

import process from "node:process";
import { ConflictException } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { and, eq } from "drizzle-orm";
import { ClsService } from "nestjs-cls";

import { type Db } from "@repo/db";
import { member, organization } from "@repo/db/schema/auth";
import {
  catalogV1,
  catalogV2,
  fenceRunV1,
  siteCosts,
  siteFenceConfig,
  siteGateConfig,
  sitePrices,
  slidingGateV1,
} from "@repo/fixtures";

import { DB } from "./common/db/db.module.js";
import { CatalogVersionsService } from "./modules/catalog-versions/catalog-versions.service.js";
import { PriceTablesService } from "./modules/price-tables/price-tables.service.js";
import { ReleasesService } from "./modules/releases/releases.service.js";
import { SeedModule } from "./seed.module.js";

/** Synthetic actor for global (non-org-scoped) publish audit rows. */
const SYSTEM_SCOPE = { userId: "system-seed", organizationId: "system-seed" } as const;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(SeedModule, {
    // Suppress Nest's DI noise; we use console.log for progress.
    logger: ["error", "warn"],
  });

  const catalogVersions = app.get(CatalogVersionsService, { strict: false });
  const releases = app.get(ReleasesService, { strict: false });
  const priceTables = app.get(PriceTablesService, { strict: false });
  const db = app.get<Db>(DB, { strict: false });
  const cls = app.get(ClsService, { strict: false });

  /** Wraps a publish call in a CLS context so @Transactional() opens properly,
   *  and catches ConflictException for idempotency. */
  async function withSkip(label: string, fn: () => Promise<unknown>): Promise<void> {
    try {
      await cls.run(() => fn());
      console.log(`  ✓ ${label}`);
    } catch (err) {
      if (err instanceof ConflictException) {
        console.log(`  – ${label} — already published, skipping`);
      } else {
        throw err;
      }
    }
  }

  // --- 1 & 2: Catalog versions -----------------------------------------------
  console.log("\n[seed] Publishing catalog versions...");

  await withSkip("catalog@1", () => catalogVersions.publish(SYSTEM_SCOPE, { body: catalogV1 }));
  await withSkip("catalog@2", () => catalogVersions.publish(SYSTEM_SCOPE, { body: catalogV2 }));

  // --- 3 & 4: Releases (pinned to catalog@2) ----------------------------------
  console.log("\n[seed] Publishing releases...");

  await withSkip("slidingGate@1", () =>
    releases.publish(SYSTEM_SCOPE, {
      catalogVersion: 2,
      body: slidingGateV1,
      initialInput: siteGateConfig,
    }),
  );

  await withSkip("fenceRun@1", () =>
    releases.publish(SYSTEM_SCOPE, {
      catalogVersion: 2,
      body: fenceRunV1,
      initialInput: siteFenceConfig,
    }),
  );

  // --- 5: Per-org price tables ------------------------------------------------
  console.log("\n[seed] Publishing per-org price tables...");

  // Fetch all organizations + their owner member (role = "owner").
  const orgs = await db
    .select({ orgId: organization.id, ownerId: member.userId })
    .from(organization)
    .innerJoin(member, and(eq(member.organizationId, organization.id), eq(member.role, "owner")));

  if (orgs.length === 0) {
    console.log(
      "\n[seed] WARNING: No organizations found in the DB. " +
        "Sign up at least one user first, then re-run `pnpm --filter api seed`.",
    );
  } else {
    for (const { orgId, ownerId } of orgs) {
      const orgScope = { userId: ownerId, organizationId: orgId };

      // Idempotency check: skip if this org already has a table at this version.
      const existing = await cls.run(() => priceTables.loadByVersion(orgScope, sitePrices.version));
      if (existing) {
        console.log(
          `  – price-table v${sitePrices.version} for org ${orgId} — already exists, skipping`,
        );
        continue;
      }

      await withSkip(`price-table v${sitePrices.version} for org ${orgId}`, () =>
        priceTables.publish(orgScope, {
          currency: "CZK",
          effectiveFrom: "2020-01-01T00:00:00.000Z",
          effectiveTo: null,
          dphRate: "0.21",
          table: sitePrices,
          cost: siteCosts,
        }),
      );
    }
  }

  await app.close();
  console.log("\n[seed] Done.\n");
  process.exit(0);
}

bootstrap().catch((err: unknown) => {
  console.error("\n[seed] FATAL:", err);
  process.exit(1);
});
