/**
 * Provides the Drizzle database (from `@repo/db`'s explicit factory) as a
 * global Nest provider and closes its pools on shutdown.
 *
 * Application code does NOT inject `DB` directly — services use the ambient
 * transactional client via `TransactionHost` (`@nestjs-cls/transactional`,
 * wired in AppModule) so every query joins the active `@Transactional()`
 * scope. `DB` exists for the CLS adapter, health checks, and boot-time code.
 */
import { Global, Inject, Module, type OnApplicationShutdown } from "@nestjs/common";

import { createDb } from "@repo/db";

import { ENV, type Env } from "../config/env.js";

export const DB = Symbol("DB");
export const DB_POOLS = Symbol("DB_POOLS");
const DB_LIFECYCLE = Symbol("DB_LIFECYCLE");

export type DbPools = ReturnType<typeof createDb>["pools"];

type DbHandle = ReturnType<typeof createDb>;

@Global()
@Module({
  providers: [
    {
      provide: DB_LIFECYCLE,
      useFactory: (env: Env): DbHandle =>
        createDb({ url: env.DATABASE_URL, poolSize: env.DATABASE_POOL_SIZE }),
      inject: [ENV],
    },
    {
      provide: DB,
      useFactory: (handle: DbHandle) => handle.db,
      inject: [DB_LIFECYCLE],
    },
    {
      provide: DB_POOLS,
      useFactory: (handle: DbHandle) => handle.pools,
      inject: [DB_LIFECYCLE],
    },
  ],
  exports: [DB, DB_POOLS],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(DB_LIFECYCLE) private readonly handle: DbHandle) {}

  async onApplicationShutdown(): Promise<void> {
    await this.handle.close();
  }
}
