/**
 * Audit writer (spec §7.7, ADR 0040). Two guarantees:
 *
 * 1. ATOMIC WHEN IT MATTERS — `txHost.tx` resolves to the ambient
 *    `@Transactional()` client when a transaction is active (the audit row
 *    commits or rolls back WITH the business change), and falls back to the
 *    plain connection otherwise (audit from non-transactional paths, e.g.
 *    worker jobs).
 * 2. FAIL-SOFT — an audit failure must never fail the business operation:
 *    errors are caught and logged, never rethrown. (Caveat: if the insert
 *    fails INSIDE an active Postgres transaction, that transaction is already
 *    aborted and the business commit will fail regardless — fail-soft mainly
 *    covers the non-transactional path and serialization/connection noise.)
 *
 * `requestId` correlation: the pino request id (`genReqId` in AppModule)
 * lives on the raw request object, which nestjs-cls's mounted middleware
 * stores under `CLS_REQ` (`saveReq` defaults to true). Workers have no
 * request context — pass `requestId` explicitly there if there is one.
 */
import { TransactionHost } from "@nestjs-cls/transactional";
import { type TransactionalAdapterDrizzleOrm } from "@nestjs-cls/transactional-adapter-drizzle-orm";
import { Injectable, Logger, Optional } from "@nestjs/common";
import { CLS_REQ, ClsService } from "nestjs-cls";

import { type Db } from "@repo/db";
import { audit } from "@repo/db/schema/audit";

export interface AuditEntry {
  /** Acting user id; omit/null for system actions. */
  actorId?: string | null;
  /** Dot-namespaced verb: "project.create", "privacy.erase", … */
  action: string;
  entityType: string;
  entityId: string;
  /** Before/after diff — IDs and non-PII fields only (ADR 0040). */
  diff?: Record<string, unknown>;
  /** Explicit override for contexts without a CLS request (worker jobs). */
  requestId?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterDrizzleOrm<Db>>,
    @Optional() private readonly cls?: ClsService,
  ) {}

  /** Append an audit row. Never throws (fail-soft — see module doc). */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.txHost.tx.insert(audit).values({
        actorId: entry.actorId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        diff: entry.diff ?? null,
        requestId: entry.requestId ?? this.requestIdFromCls(),
      });
    } catch (error) {
      this.logger.error(
        `audit write failed (action=${entry.action} entity=${entry.entityType}/${entry.entityId}) — continuing`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /** Pino request id via the CLS-saved request object; null off-request. */
  private requestIdFromCls(): string | null {
    try {
      if (!this.cls?.isActive()) return null;
      const request = this.cls.get<{ id?: unknown } | undefined>(CLS_REQ);
      return typeof request?.id === "string" ? request.id : null;
    } catch {
      return null;
    }
  }
}
