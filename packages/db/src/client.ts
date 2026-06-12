/**
 * Database client factory (ADR 0032). Explicit factory — no module-global
 * connection — mirroring the repo's `createApiClient` pattern (ADR 0012).
 *
 * Pooling doctrine (ADR 0038): small per-instance pools; the deployment must
 * keep `poolSize × replicas` under Postgres `max_connections` (or front with
 * PgBouncer in transaction mode — the compose `pgbouncer` profile mirrors
 * this). Code stays transaction-pooling-safe: no session GUCs, no
 * LISTEN/NOTIFY, no prepared-statement reliance.
 *
 * Read-replica seam: pass `replicaUrls` to route reads via Drizzle
 * `withReplicas`; defaults to the primary (same DSN) so wiring a replica
 * later is config, not a refactor. Mind replica lag on read-your-writes
 * paths — use `db.$primary` for those reads.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { withReplicas } from "drizzle-orm/pg-core";
import { Pool } from "pg";

export interface CreateDbOptions {
  /** Primary DSN, e.g. postgres://app:app@localhost:5432/app */
  url: string;
  /** Optional read-replica DSNs (ADR 0038 seam). */
  replicaUrls?: readonly string[];
  /** Per-instance pool size. Keep small (ADR 0038). */
  poolSize?: number;
  /** Statement timeout (ms) applied connection-wide. */
  statementTimeoutMs?: number;
}

export type Db = ReturnType<typeof createDb>["db"];

export function createDb(options: CreateDbOptions) {
  const { url, replicaUrls = [], poolSize = 10, statementTimeoutMs = 30_000 } = options;

  const makePool = (connectionString: string) =>
    new Pool({
      connectionString,
      max: poolSize,
      statement_timeout: statementTimeoutMs,
    });

  const primaryPool = makePool(url);
  const replicaPools = replicaUrls.map(makePool);

  const primary = drizzle({ client: primaryPool });
  const [firstReplica, ...restReplicas] = replicaPools.map((pool) => drizzle({ client: pool }));

  const db = firstReplica
    ? withReplicas(primary, [firstReplica, ...restReplicas])
    : withReplicas(primary, [primary]);

  return {
    db,
    /** Pool handles for observability (gauge sampling) — read-only use. */
    pools: { primary: primaryPool, replicas: replicaPools },
    /** Close every pool — call on graceful shutdown. */
    close: async () => {
      await Promise.all([primaryPool, ...replicaPools].map((p) => p.end()));
    },
  };
}
