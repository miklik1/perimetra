/**
 * Seed entrypoint — publishes the golden corpus into the DB via the existing
 * publish services (admin-publish slice, WS4). Runs AFTER migrations.
 *
 * Idempotent WITH drift detection (ADR 0100, CAR-31): a store row that already
 * exists is compared against the fixture at git HEAD — byte-identical → skip;
 * DIFFERENT → hard error. The old silent ConflictException-skip is what let an
 * in-place fixture edit never reach an already-seeded DB (the 2026-07-02 NO-GO:
 * stale diagonal/fills/prices). The error names both remediations: bump the
 * fixture version (the real cutover discipline), or `seed:reset` + `seed` for
 * the dev-only in-place loop.
 *
 * Catalog versions + releases are global vendor data (no org scope) — published
 * via the services (bypassing the HTTP `PlatformGuard`, ADR 0062). Per-tenant
 * VISIBILITY (ADR 0062) is then provisioned: every org is ASSIGNED the golden
 * corpus so dev `/configurator`·`/site` keep working (a fresh signup made AFTER
 * the seed starts with NO assignments — the vendor assigns explicitly). If
 * `PLATFORM_ADMIN_EMAIL` is set, that user is promoted to the platform operator.
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
import { isDeepStrictEqual } from "node:util";
import { ConflictException } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { and, eq } from "drizzle-orm";
import { ClsService } from "nestjs-cls";

import { type Db } from "@repo/db";
import { member, organization, user } from "@repo/db/schema/auth";
import { legalProfile } from "@repo/db/schema/legal-profiles";
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

  /** Wraps a publish call in a CLS context so @Transactional() opens properly.
   *  Returns false on ConflictException (someone else published concurrently)
   *  so the caller can fall through to the drift compare. */
  async function tryPublish(label: string, fn: () => Promise<unknown>): Promise<boolean> {
    try {
      await cls.run(() => fn());
      console.log(`  ✓ ${label}`);
      return true;
    } catch (err) {
      if (err instanceof ConflictException) return false;
      throw err;
    }
  }

  /** Drift guard (ADR 0100): an already-published store row must match the
   *  fixture at git HEAD. Silent skip-on-conflict is what let in-place fixture
   *  edits never reach a seeded DB — a mismatch is a hard, actionable error. */
  function assertNoDrift(label: string, dbValue: unknown, fixtureValue: unknown): void {
    // JSON round-trip both sides: JSONB storage drops `undefined`-valued keys,
    // so a fixture's explicit `foo: undefined` must not read as drift.
    const canon = (v: unknown): unknown => JSON.parse(JSON.stringify(v)) as unknown;
    if (isDeepStrictEqual(canon(dbValue), canon(fixtureValue))) {
      console.log(`  – ${label} — already published (matches HEAD fixtures), skipping`);
      return;
    }
    throw new Error(
      `[seed] DRIFT: ${label} exists in the DB with a DIFFERENT body than the ` +
        `fixture at HEAD. Published rows are immutable (I3) — either bump the ` +
        `fixture's version and publish it as a NEW release (the cutover ` +
        `discipline, ADR 0100; the ONLY path once real quotes stamp the row), ` +
        `or resync a dev DB that holds nothing real: ` +
        `pnpm --filter api seed:reset && pnpm --filter api seed`,
    );
  }

  /** Publish-or-verify, race-safe: pre-check → drift compare; else publish; a
   *  publish 409 (concurrent seed won the race) re-loads and STILL drift-checks
   *  — the losing side must never silently skip (that was the ADR 0100 hole). */
  async function publishOrVerify(
    label: string,
    load: () => Promise<unknown | null>,
    publish: () => Promise<unknown>,
    fixtureValue: unknown,
  ): Promise<void> {
    const existing = await cls.run(() => load());
    if (existing) {
      assertNoDrift(label, existing, fixtureValue);
      return;
    }
    if (await tryPublish(label, publish)) return;
    const raced = await cls.run(() => load());
    if (!raced) throw new Error(`[seed] ${label}: publish 409'd but the row is absent on re-load`);
    assertNoDrift(label, raced, fixtureValue);
  }

  // --- 1 & 2: Catalog versions -----------------------------------------------
  console.log("\n[seed] Publishing catalog versions...");

  for (const [label, body] of [
    ["catalog@1", catalogV1],
    ["catalog@2", catalogV2],
  ] as const) {
    await publishOrVerify(
      label,
      () => catalogVersions.loadCatalog(body.version),
      () => catalogVersions.publish(SYSTEM_SCOPE, { body }),
      body,
    );
  }

  // --- 3 & 4: Releases (pinned to catalog@2) ----------------------------------
  console.log("\n[seed] Publishing releases...");

  for (const [label, body, initialInput] of [
    ["slidingGate@1", slidingGateV1, siteGateConfig],
    ["fenceRun@1", fenceRunV1, siteFenceConfig],
  ] as const) {
    await publishOrVerify(
      label,
      async () => {
        const detail = await releases.loadByReleaseId(body.id);
        // Compare every frozen column the ADR 0100 trigger guards, not just
        // the body — a catalogVersion drift is the same class of bug.
        return detail ? { body: detail.body, catalogVersion: detail.catalogVersion } : null;
      },
      () => releases.publish(SYSTEM_SCOPE, { catalogVersion: 2, body, initialInput }),
      { body, catalogVersion: 2 },
    );
  }

  // --- 5: Platform operator (ADR 0062) ---------------------------------------
  // Promote the configured user so they can publish + assign through the /platform
  // console in dev. Idempotent — re-setting the same role is a no-op.
  const platformEmail = process.env.PLATFORM_ADMIN_EMAIL?.toLowerCase();
  if (platformEmail) {
    console.log("\n[seed] Promoting platform operator...");
    const promoted = await db
      .update(user)
      .set({ role: "admin" })
      .where(eq(user.email, platformEmail))
      .returning({ id: user.id });
    console.log(
      promoted.length > 0
        ? `  ✓ platform operator: ${platformEmail}`
        : `  – platform operator ${platformEmail} not found (sign up first), skipping`,
    );
  }

  // --- 6: Per-org release assignment + price tables --------------------------
  console.log("\n[seed] Provisioning per-org assignments + price tables...");

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
    // One org's drift must not strand the others: collect per-org drift errors,
    // finish provisioning EVERY org, then fail the run at the end (still loud).
    const orgDriftErrors: string[] = [];
    for (const { orgId, ownerId } of orgs) {
      const orgScope = { userId: ownerId, organizationId: orgId };

      // Per-tenant VISIBILITY (ADR 0062): assign the golden corpus to this org
      // so the configurator/site see it. assign() is idempotent (the unique
      // index no-ops a re-assign), so re-running the seed is safe.
      for (const releaseId of [slidingGateV1.id, fenceRunV1.id]) {
        await tryPublish(`assign ${releaseId} → org ${orgId}`, () =>
          releases.assign(SYSTEM_SCOPE.userId, orgId, releaseId),
        );
      }

      // Demo legal profile (ADR 0088) so this org can ISSUE (a quote 422s
      // `legal_profile_required` without one) + the §92e demo works (vatPayer).
      // onConflictDoNothing: a re-seed never clobbers a profile the org has edited.
      await db
        .insert(legalProfile)
        .values({
          organizationId: orgId,
          ownerId,
          name: "Perimetra Demo s.r.o.",
          ico: "01234567",
          dic: "CZ01234567",
          vatPayer: true,
          addressLine: "Tovární 5",
          city: "Olomouc",
          postalCode: "779 00",
          country: "CZ",
          bankAccount: "123456789/0800",
          registrationNote:
            "Zapsáno v OR vedeném Krajským soudem v Ostravě, oddíl C, vložka 12345.",
        })
        .onConflictDoNothing({ target: legalProfile.organizationId });

      // Idempotency check with drift guard: an existing table at this version
      // must match the HEAD fixture (the 2026-07-02 NO-GO (b) was exactly a
      // stale seeded price table missing `lamela_113`). Compare every frozen
      // column the seed authors — roundingPolicy is server-defaulted on the
      // wire, so it stays out. A drift here is PER-ORG: record it, keep going.
      try {
        await publishOrVerify(
          `price-table v${sitePrices.version} for org ${orgId}`,
          async () => {
            const t = await priceTables.loadByVersion(orgScope, sitePrices.version);
            return t
              ? { table: t.table, cost: t.cost, dphRate: t.dphRate, currency: t.currency }
              : null;
          },
          () =>
            priceTables.publish(orgScope, {
              currency: "CZK",
              effectiveFrom: "2020-01-01T00:00:00.000Z",
              effectiveTo: null,
              // DPH as a PERCENT (ADR 0080) — the old "0.21" was a latent bug,
              // never applied (the tax field was vestigial); now the tax layer
              // uses it.
              dphRate: "21",
              table: sitePrices,
              cost: siteCosts,
            }),
          { table: sitePrices, cost: siteCosts, dphRate: "21", currency: "CZK" },
        );
      } catch (err) {
        orgDriftErrors.push(err instanceof Error ? err.message : String(err));
        console.error(`  ✗ org ${orgId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (orgDriftErrors.length > 0) {
      throw new Error(
        `[seed] ${orgDriftErrors.length} org(s) had price-table drift (all other orgs were still provisioned — see ✗ lines above)`,
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
