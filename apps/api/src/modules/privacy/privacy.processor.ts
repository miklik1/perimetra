/**
 * Privacy queue consumer (worker deployable) — the GDPR fan-out (spec §7.7,
 * ADR 0040) plus the audit retention sweep:
 *
 * - `privacy-export` (Art. 20): collect every `PrivacyHandler.exportUser`
 *   into one JSON document, store it to S3 under
 *   `privacy-exports/<userId>/<uuid>.json` (presigned PUT — the api never
 *   proxies bytes, and neither does the worker hold raw S3 writes) and log
 *   the key. Download delivery (signed link to the user) is wired later.
 * - `privacy-erase` (Art. 17): every handler's `eraseUser`, then the
 *   BUILT-IN core erasures (anonymize the Better Auth user row, delete
 *   sessions + accounts + two-factor secrets), then the third-party purge
 *   hooks, then an audit row (`privacy.erase`). All steps idempotent — jobs retry.
 * - `audit-cleanup`: scheduled daily here (own scheduler id, own queue — the
 *   maintenance processor stays untouched); deletes audit rows older than
 *   the 2-year retention (spec §11) via a UUIDv7 time-boundary so the sweep
 *   rides the PK index.
 *
 * DLQ convention (ADR 0043): exhausted jobs are re-added to `dlq` with
 * origin metadata, same as the events processor.
 */
import { TransactionHost } from "@nestjs-cls/transactional";
import { type TransactionalAdapterDrizzleOrm } from "@nestjs-cls/transactional-adapter-drizzle-orm";
import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { Inject, Logger, Optional, type OnApplicationBootstrap } from "@nestjs/common";
import { Queue, type Job } from "bullmq";
import { eq, lt } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { type Db } from "@repo/db";
import { audit } from "@repo/db/schema/audit";
import { account, session, twoFactor, user } from "@repo/db/schema/auth";

import { AuditService } from "../audit/audit.service.js";
import { upsertScheduler } from "../jobs/jobs.module.js";
import { QUEUES } from "../jobs/jobs.tokens.js";
import { StorageService } from "../storage/storage.service.js";
import {
  PRIVACY_HANDLERS,
  PRIVACY_JOBS,
  PURGE_HOOKS,
  type PrivacyHandler,
  type PurgeHook,
} from "./privacy.tokens.js";

/** Audit retention (spec §11): 2 years, then the daily sweep deletes. */
const AUDIT_RETENTION_MS = 2 * 365 * 24 * 60 * 60 * 1_000;

/** Distinct scheduler id — must not collide with the maintenance queue's. */
const AUDIT_CLEANUP_SCHEDULER_ID = "audit-cleanup";

/**
 * Smallest possible UUIDv7 for a given instant: 48-bit unix-ms prefix, then
 * the minimum legal version (0x7) and variant (0b10) nibbles, zeros after.
 * Every UUIDv7 generated at-or-after `date` sorts >= this (Postgres compares
 * uuids bytewise), so `id < uuidv7Boundary(cutoff)` selects exactly the rows
 * created before the cutoff — on the PK index, no created_at scan.
 */
export function uuidv7Boundary(date: Date): string {
  const hex = Math.max(0, date.getTime()).toString(16).padStart(12, "0").slice(-12);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7000-8000-000000000000`;
}

@Processor(QUEUES.privacy)
export class PrivacyProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(PrivacyProcessor.name);

  constructor(
    @InjectQueue(QUEUES.privacy) private readonly privacyQueue: Queue,
    @InjectQueue(QUEUES.dlq) private readonly dlq: Queue,
    private readonly txHost: TransactionHost<TransactionalAdapterDrizzleOrm<Db>>,
    private readonly storage: StorageService,
    private readonly auditService: AuditService,
    @Optional()
    @Inject(PRIVACY_HANDLERS)
    private readonly handlers: PrivacyHandler[] = [],
    @Optional()
    @Inject(PURGE_HOOKS)
    private readonly purgeHooks: PurgeHook[] = [],
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    // Own scheduler on the PRIVACY queue (ADR 0043's repeatables-only cron) —
    // deliberately NOT the maintenance queue/processor, which stays untouched.
    await upsertScheduler(
      this.privacyQueue,
      AUDIT_CLEANUP_SCHEDULER_ID,
      { pattern: "30 3 * * *", tz: "Europe/Prague" },
      { name: PRIVACY_JOBS.auditCleanup },
    );
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case PRIVACY_JOBS.export:
        return await this.exportUser((job.data as { userId: string }).userId);
      case PRIVACY_JOBS.erase:
        return await this.eraseUser((job.data as { userId: string }).userId);
      case PRIVACY_JOBS.auditCleanup:
        return await this.cleanupAudit();
      default:
        this.logger.warn(`unknown privacy job "${job.name}"`);
    }
  }

  /** Art. 20: one JSON document from every handler, stored to S3. */
  private async exportUser(userId: string): Promise<void> {
    const data: Record<string, unknown> = {};
    for (const handler of this.handlers) {
      data[handler.entityType] = await handler.exportUser(userId);
    }

    const body = JSON.stringify({ userId, exportedAt: new Date().toISOString(), data }, null, 2);
    const key = `privacy-exports/${userId}/${uuidv7()}.json`;
    const { url } = await this.storage.presignUpload({
      key,
      contentType: "application/json",
      contentLength: Buffer.byteLength(body),
    });

    // PUT against the presigned URL — content-type/length are signed, and the
    // string body makes fetch's computed content-length match the signature.
    const response = await fetch(url, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body,
    });
    if (!response.ok) {
      throw new Error(`privacy export upload for user ${userId} failed: ${response.status}`);
    }

    // Delivery (signed download link to the user) is a later phase — the key
    // in the logs is the operator's handle until then.
    this.logger.log(
      `privacy export for user ${userId} stored at ${key} (${this.handlers.length} handlers)`,
    );
  }

  /** Art. 17: handler fan-out, then core erasures, then purge hooks. */
  private async eraseUser(userId: string): Promise<void> {
    // 1. Domain handlers first — they may need the (still intact) user row.
    for (const handler of this.handlers) {
      await handler.eraseUser(userId);
    }

    // 2. Built-in core erasures on the Better Auth tables. Anonymize (not
    //    delete) the user row: FKs keep pointing at a valid, PII-free id.
    //    Deterministic value → idempotent on retry, and the unique email
    //    constraint stays satisfied per user. This is also what makes the
    //    quote/price_table `owner_id RESTRICT` (ADR 0055, I3 durability) safe:
    //    the user row is never hard-deleted, so the frozen commercial records
    //    survive erasure under legal-retention while their author goes PII-free.
    const erased = `erased-${userId}@erased.invalid`;
    const db = this.txHost.tx; // ambient tx if active, plain client otherwise
    await db
      .update(user)
      .set({ name: erased, email: erased, image: null, twoFactorEnabled: false })
      .where(eq(user.id, userId));
    await db.delete(session).where(eq(session.userId, userId));
    await db.delete(account).where(eq(account.userId, userId));
    // Credentials are PURGED, not anonymized: the password hash (`account`) and
    // the TOTP secret + backup codes (`twoFactor`). Their FKs would CASCADE on a
    // user-row delete, but erasure ANONYMIZES the user row (I3 durability), so
    // the cascade never fires — delete them explicitly. Also clears the now-stale
    // `twoFactorEnabled` flag so a re-created account never inherits it.
    await db.delete(twoFactor).where(eq(twoFactor.userId, userId));

    // 3. Third-party purges — Sentry + PostHog hooks, bound under
    //    PURGE_HOOKS in privacy-worker.module.ts (ADR 0040).
    for (const hook of this.purgeHooks) {
      await hook.purgeUser(userId);
    }

    // 4. Erasure is itself an Art. 30 processing activity — audit it
    //    (system action: no actor, no request context).
    await this.auditService.record({
      action: "privacy.erase",
      entityType: "user",
      entityId: userId,
    });
    this.logger.log(
      `privacy erasure for user ${userId} complete ` +
        `(${this.handlers.length} handlers, ${this.purgeHooks.length} purge hooks)`,
    );
  }

  /** Retention sweep: audit rows older than 2 years (PK-index range). */
  private async cleanupAudit(): Promise<void> {
    const cutoff = new Date(Date.now() - AUDIT_RETENTION_MS);
    await this.txHost.tx.delete(audit).where(lt(audit.id, uuidv7Boundary(cutoff)));
    this.logger.log(`audit retention sweep done (cutoff ${cutoff.toISOString()})`);
  }

  @OnWorkerEvent("failed")
  async onFailed(job: Job | undefined, error: Error): Promise<void> {
    if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;

    await this.dlq.add(job.name, {
      origin: { queue: QUEUES.privacy, jobId: job.id, name: job.name },
      failedReason: error.message,
      data: job.data,
    });
    this.logger.error(
      `privacy job ${job.id} (${job.name}) exhausted retries — moved to DLQ: ${error.message}`,
    );
  }
}
