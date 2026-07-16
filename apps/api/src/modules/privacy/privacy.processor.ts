/**
 * Privacy queue consumer (worker deployable) — the GDPR fan-out (spec §7.7,
 * ADR 0040) plus the audit retention sweep:
 *
 * - `privacy-export` (Art. 20): collect every `PrivacyHandler.exportUser`
 *   into one JSON document, store it to S3 under
 *   `privacy-exports/<userId>/<uuid>.json` (presigned PUT — the api never
 *   proxies bytes, and neither does the worker hold raw S3 writes) and log
 *   the key. Download delivery (signed link to the user) is wired later.
 * - `privacy-erase` (Art. 17): every handler's `eraseUser`, then a
 *   `finalizeErasure` second pass (ADR 1010 cross-cutting repairs), then the
 *   BUILT-IN core erasures (anonymize the Better Auth user row, delete
 *   sessions + accounts + two-factor secrets), then the third-party purge hooks
 *   whose `PurgeOutcome`s are collected into a read-model recorded in the
 *   `privacy.erase` audit diff and returned as `job.returnvalue` (ADR 1010). All
 *   steps idempotent — jobs retry; a hard purge failure THROWS and DLQs
 *   (ban-purge escalation).
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
  type PurgeOutcome,
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
    // Reserved-key invariant (ADR 1004 amendment): the Art. 20 export emits the
    // Better Auth `user` row under `data.user` as a built-in core step that runs
    // AFTER the handler fan-out — so a domain handler that also claimed
    // entityType "user" would be silently overwritten, a soundless GDPR-export
    // completeness regression. `PrivacyHandler.entityType` is a plain `string`,
    // so enforce the reservation structurally here: a colliding handler fails
    // BOOT (caught in CI/dev), never loses data at run time.
    const reserved = this.handlers.filter((h) => h.entityType === "user");
    if (reserved.length > 0) {
      throw new Error(
        `PrivacyHandler entityType "user" is reserved for the built-in Art. 20 core step ` +
          `(ADR 1004); ${reserved.length} handler(s) claim it and would be silently clobbered — ` +
          `rename the handler's entityType.`,
      );
    }

    // Own scheduler on the PRIVACY queue (ADR 0043's repeatables-only cron) —
    // deliberately NOT the maintenance queue/processor, which stays untouched.
    await upsertScheduler(
      this.privacyQueue,
      AUDIT_CLEANUP_SCHEDULER_ID,
      { pattern: "30 3 * * *", tz: "Europe/Prague" },
      { name: PRIVACY_JOBS.auditCleanup },
    );
  }

  async process(job: Job): Promise<Record<string, PurgeOutcome> | undefined> {
    switch (job.name) {
      case PRIVACY_JOBS.export:
        await this.exportUser((job.data as { userId: string }).userId);
        return undefined;
      case PRIVACY_JOBS.erase:
        // Returned so BullMQ stores the purge read-model as `job.returnvalue`.
        return await this.eraseUser((job.data as { userId: string }).userId);
      case PRIVACY_JOBS.auditCleanup:
        await this.cleanupAudit();
        return undefined;
      default:
        this.logger.warn(`unknown privacy job "${job.name}"`);
        return undefined;
    }
  }

  /** Art. 20: one JSON document from every handler, stored to S3. */
  private async exportUser(userId: string): Promise<void> {
    const data: Record<string, unknown> = {};
    for (const handler of this.handlers) {
      // Tag every entity with its GDPR data-category (Art. 9 special-category
      // data is identified, not basis-blind) alongside the handler's collections.
      // `category` is spread LAST so the classification is always authoritative —
      // a handler collection key can never clobber it.
      data[handler.entityType] = {
        ...(await handler.exportUser(userId)),
        category: handler.dataCategory ?? "ordinary",
      };
    }

    // Built-in core step (Art. 20): the Better Auth `user` row is not a domain
    // handler's to export — it is emitted here directly, symmetric with the
    // core anonymization eraseUser() already applies to the same row. Without
    // it, the subject's own name / email / avatar / locale / timestamps are
    // absent from the document they download. No domain handler may claim the
    // reserved `"user"` entityType.
    //
    // Explicit FAIL-CLOSED allow-list (HQ-ruled scope, ADR 1004): only the
    // subject's identity + preference fields. Excludes the admin() moderation
    // flags (`role`/`banned`/`banReason`/`banExpires` — internal, per
    // me.controller.ts's client allow-list) and never reads `account`/`session`
    // (password hash, OAuth tokens, session artifacts). A column added to the
    // `user` table later does NOT enter the export until listed here on purpose.
    // The SELECT is column-projected to the SAME allow-list (defense-in-depth,
    // ADR 1004 amendment): a later `user` column never even enters process
    // memory, not just the output document. The two lists (projection + object
    // literal below) are kept in lockstep by the exact-key-set contract test.
    const [row] = await this.txHost.tx
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
        image: user.image,
        locale: user.locale,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      })
      .from(user)
      .where(eq(user.id, userId));
    if (row) {
      data.user = {
        id: row.id,
        name: row.name,
        email: row.email,
        emailVerified: row.emailVerified,
        image: row.image,
        locale: row.locale,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        category: "ordinary",
      };
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

  /**
   * Art. 17: handler fan-out, then a finalize second pass, then core erasures,
   * then purge hooks, then the audit row. Returns the purge read-model so it
   * lands in `job.returnvalue`; it is also mirrored into the `privacy.erase`
   * audit diff (ADR 1010).
   */
  private async eraseUser(userId: string): Promise<Record<string, PurgeOutcome>> {
    // 1. Domain handlers first — they may need the (still intact) user row. A
    //    thrown handler propagates (job → onFailed → DLQ); it is not caught.
    for (const handler of this.handlers) {
      await handler.eraseUser(userId);
    }

    // 2. Finalize second pass (ADR 1010, ports anyora ADR 0067): once the WHOLE
    //    eraseUser fan-out is applied — including cross-module deletes another
    //    handler owns — each handler may run a cross-cutting repair its own
    //    per-subject eraseUser could not express, because by loop-end the
    //    subject linkage is gone. Runs BEFORE the built-in core erasures.
    for (const h of this.handlers) {
      await h.finalizeErasure?.(userId);
    }

    // 3. Built-in core erasures on the Better Auth tables. Anonymize (not
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

    // 4. Third-party purges — Sentry + PostHog hooks, bound under PURGE_HOOKS
    //    in privacy-worker.module.ts (ADR 0040). Each returns a PurgeOutcome
    //    collected into the read-model, keyed by hook name; a HARD failure
    //    THROWS and propagates (ban-purge escalation), never a swallowed
    //    return. A documented/skipped outcome does NOT downgrade the erasure.
    const purges: Record<string, PurgeOutcome> = {};
    for (const hook of this.purgeHooks) {
      purges[hook.name] = await hook.purgeUser(userId);
    }

    // 5. Erasure is itself an Art. 30 processing activity — audit it (system
    //    action: no actor, no request context), recording the purge read-model
    //    in the diff so the audit trail shows what each third party did.
    await this.auditService.record({
      action: "privacy.erase",
      entityType: "user",
      entityId: userId,
      diff: { purges },
    });
    this.logger.log(
      `privacy erasure for user ${userId} complete ` +
        `(${this.handlers.length} handlers, ${this.purgeHooks.length} purge hooks)`,
    );
    return purges;
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
