/**
 * One-shot migration entrypoint (ADR 0038): runs as the release phase BEFORE
 * the api/worker roll — never at app boot (N replicas racing migrations).
 * Exit 0 = proceed with rollout; non-zero = abort the deploy.
 *
 * Migration doctrine: expand/contract — every migration must be compatible
 * with the previous code version, so rollback is "previous image", never a
 * down-migration.
 */
import { existsSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

import { migrationsFolder } from "@repo/db/migrations-path";

import { loadEnv } from "./common/config/env.js";

async function run(): Promise<void> {
  const env = loadEnv();

  if (!existsSync(migrationsFolder)) {
    console.log(`no migrations folder at ${migrationsFolder} — nothing to do`);
    return;
  }

  // `lock_timeout=5s` is set CONNECTION-WIDE (libpq `-c`), not just per-file:
  // ADR 0038 mandates the fail-fast lock guard, but drizzle-kit does NOT emit the
  // `SET lock_timeout` preamble for incremental ALTER/ADD-COLUMN migrations (only
  // hand-written CREATE migrations carry it), so the per-file convention silently
  // drifts. Setting it on the migrator connection covers EVERY migration — past,
  // future, and drizzle-generated — uniformly. A migration may still re-`SET` it
  // (harmless). See the engineering finding on this drift class.
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 1,
    options: "-c lock_timeout=5s",
  });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder });
    console.log("migrations applied");
  } finally {
    await pool.end();
  }
}

run().catch((error: unknown) => {
  console.error("migration failed:", error);
  process.exitCode = 1;
});
