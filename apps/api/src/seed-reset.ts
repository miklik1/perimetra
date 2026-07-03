/**
 * DEV-ONLY reseed reset — the "one shared data path" for the model stores.
 *
 * The configurator/site read the immutable DB (ADR 0060); scene-lab + the golden
 * tests read `@repo/fixtures` at git HEAD. During the active rebuild, fixture
 * release BODIES are edited in place under a frozen `id@version` (e.g. ADR 0095's
 * geometry fix, ADR 0097's fill types) — but published releases are immutable (I3)
 * and the seed is idempotent-SKIP, so an already-seeded dev DB keeps the OLD body
 * forever. That is the drift behind the recurring "engine correct at HEAD, app
 * shows a stale/broken model" reviews (the 2026-07-02 NO-GO: stale `180 - angle`
 * diagonal + a 2-fill body + a price table missing `lamela_113`).
 *
 * This wipes the model stores so a following `pnpm --filter api seed` republishes
 * the current-HEAD fixtures — after which the configurator (DB) and scene-lab
 * (fixtures) render the IDENTICAL body. It is the dev resync any box/staging needs
 * whenever fixtures change; production releases stay immutable (this refuses to run
 * there, and is never wired into boot/migrate). Since ADR 0100 the drift is also
 * LOUD: the seed hard-errors on a body mismatch (pointing here), DB triggers
 * block in-place UPDATEs outright, and once a real quote stamps a release the
 * only path for a model change is a version bump (publish `model@N+1`).
 *
 * Guard: refuses unless NODE_ENV !== "production". Usage:
 *   pnpm --filter api build && pnpm --filter api exec node dist/seed-reset.js && pnpm --filter api seed
 *
 * FK note: quotes/projects reference release + price_table ON DELETE RESTRICT (I3
 * durability). This deletes ONLY the vendor/model stores + their disposable joins;
 * if a quote/project exists it will (correctly) refuse — reset those first in dev.
 */
import "reflect-metadata";

import process from "node:process";
import { NestFactory } from "@nestjs/core";

import { type Db } from "@repo/db";
import { catalogVersion } from "@repo/db/schema/catalog-versions";
import { priceTable } from "@repo/db/schema/price-tables";
import { releaseDraft } from "@repo/db/schema/release-drafts";
import { orgModelPin, orgReleaseAssignment, release } from "@repo/db/schema/releases";

import { DB } from "./common/db/db.module.js";
import { SeedModule } from "./seed.module.js";

async function bootstrap(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    console.error("[seed-reset] refusing to run with NODE_ENV=production");
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(SeedModule, {
    logger: ["error", "warn"],
  });
  const db = app.get<Db>(DB, { strict: false });

  // Disposable joins first (natural-key refs to releaseId/modelId), then the
  // immutable model stores. Drafts are mutable working-state — cleared too.
  console.log("[seed-reset] clearing model stores (dev resync to HEAD fixtures)...");
  await db.delete(orgReleaseAssignment);
  await db.delete(orgModelPin);
  await db.delete(releaseDraft);
  await db.delete(priceTable);
  await db.delete(release);
  await db.delete(catalogVersion);
  console.log("[seed-reset] done — run `pnpm --filter api seed` to republish HEAD.");

  await app.close();
}

await bootstrap();
