/**
 * Deliveries repository (ADR 0129) — drizzle queries through the ambient
 * transactional client (`TransactionHost`, ADR 0037): inside the
 * `@Transactional()` send method `tx` IS the send transaction, so the delivery
 * row, its outbox event and the audit row commit or roll back together.
 *
 * Request-path reads are org-scoped via `scoped()` (ADR 0041/0055) with the
 * per-rep ownership narrowing (ADR 0082) layered on top — a delivery record
 * inherits the visibility of the rep who sent it.
 *
 * The three status writes (`claimForSend` / `markSent` / `markFailed`) are the
 * WORKER's surface and are deliberately scope-LESS: a worker handler re-fetches
 * from an IDs-only payload (ADR 0037) and has no `RequestScope`. `claimForSend`
 * is a CONDITIONAL update (`WHERE status = 'queued' … RETURNING`) — it is the
 * structural at-most-once guard, not an optimisation (see its docblock).
 *
 * There is no `update` and no `softDelete`: the evidence of an outward act is
 * neither editable nor tombstonable.
 */
import { TransactionHost } from "@nestjs-cls/transactional";
import { type TransactionalAdapterDrizzleOrm } from "@nestjs-cls/transactional-adapter-drizzle-orm";
import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gt, lt } from "drizzle-orm";

import { type Db } from "@repo/db";
import {
  documentDelivery,
  type DeliveryDocumentType,
  type DocumentDeliveryRow,
} from "@repo/db/schema/deliveries";

import { type RequestScope } from "../../common/tenancy/request-scope.js";

export interface ListDeliveriesParams {
  cursor?: string | undefined;
  limit: number;
  sort: "createdAt:asc" | "createdAt:desc";
  documentType: DeliveryDocumentType;
  documentId: string;
}

export interface DeliveriesPageRows {
  items: DocumentDeliveryRow[];
  /** Id of the last returned row when more exist — UUIDv7 keyset cursor. */
  nextCursor: string | null;
}

/** Per-rep ownership narrowing (ADR 0082) — layered ON TOP of the org scope,
 *  never replacing it. admin sees the whole org; a rep sees its own sends. */
export interface DeliveryScopeOpts {
  restrictToOwner: boolean;
}

/** Everything frozen at the moment the rep pressed send. */
export interface InsertDeliveryData {
  documentType: DeliveryDocumentType;
  documentId: string;
  documentNumber: string;
  customerId: string;
  recipientEmail: string;
  locale: string | null;
  linkPath: string | null;
  amountMoney: string | null;
  currency: string | null;
  variableSymbol: string | null;
  dueOn: string | null;
  payToIban: string | null;
}

@Injectable()
export class DeliveriesRepository {
  constructor(private readonly txHost: TransactionHost<TransactionalAdapterDrizzleOrm<Db>>) {}

  /** THE access filter: org scope ALWAYS (ADR 0041/0055) plus the per-rep
   *  narrowing (ADR 0082). The owner filter NEVER replaces the org filter. */
  private scoped(scope: RequestScope, opts: DeliveryScopeOpts) {
    return and(
      eq(documentDelivery.organizationId, scope.organizationId),
      opts.restrictToOwner ? eq(documentDelivery.ownerId, scope.userId) : undefined,
    );
  }

  /** The send history of ONE document, keyset by id (UUIDv7 = creation order).
   *  Honours the shared `sort` contract so the repo keeps one list idiom. */
  async list(
    scope: RequestScope,
    opts: DeliveryScopeOpts,
    params: ListDeliveriesParams,
  ): Promise<DeliveriesPageRows> {
    const ascending = params.sort === "createdAt:asc";
    const rows = await this.txHost.tx
      .select()
      .from(documentDelivery)
      .where(
        and(
          this.scoped(scope, opts),
          eq(documentDelivery.documentType, params.documentType),
          eq(documentDelivery.documentId, params.documentId),
          params.cursor
            ? ascending
              ? gt(documentDelivery.id, params.cursor)
              : lt(documentDelivery.id, params.cursor)
            : undefined,
        ),
      )
      .orderBy(ascending ? asc(documentDelivery.id) : desc(documentDelivery.id))
      .limit(params.limit + 1);

    const items = rows.slice(0, params.limit);
    const nextCursor = rows.length > params.limit ? (items.at(-1)?.id ?? null) : null;
    return { items, nextCursor };
  }

  /** Queue a send. `ownerId`/`organizationId` are stamped from the scope, never
   *  client-supplied. May throw the `document_delivery_inflight_uq` unique
   *  violation → 409 `send_in_progress` at the service. */
  async insert(scope: RequestScope, data: InsertDeliveryData): Promise<DocumentDeliveryRow> {
    const [row] = await this.txHost.tx
      .insert(documentDelivery)
      .values({
        ownerId: scope.userId,
        organizationId: scope.organizationId,
        status: "queued",
        ...data,
      })
      .returning();
    return row!;
  }

  /**
   * THE double-send guard (ADR 0129). A CONDITIONAL claim — not a
   * read-then-write — so two concurrent workers (or a BullMQ retry fired after
   * the completed job's dedup id has aged out of `removeOnComplete`) race to
   * exactly ONE winner at the storage layer. Returns null when the row is gone
   * or already claimed, and the handler then sends nothing.
   *
   * Scope-less by design: a worker has no `RequestScope` (IDs-only payload,
   * ADR 0037). The id is a UUIDv7 that only ever came out of this module's own
   * outbox event, so it is not an attacker-controlled surface.
   */
  async claimForSend(deliveryId: string): Promise<DocumentDeliveryRow | null> {
    const [row] = await this.txHost.tx
      .update(documentDelivery)
      .set({ status: "sending" })
      .where(and(eq(documentDelivery.id, deliveryId), eq(documentDelivery.status, "queued")))
      .returning();
    return row ?? null;
  }

  /** SMTP accepted the message. Terminal; it never means "delivered". */
  async markSent(deliveryId: string): Promise<void> {
    await this.txHost.tx
      .update(documentDelivery)
      .set({ status: "sent", sentAt: new Date() })
      .where(eq(documentDelivery.id, deliveryId));
  }

  /** SMTP refused it. `reason` is a NORMALIZED operator code ("smtp_error"),
   *  never the raw SMTP message — a 550 embeds the recipient address. */
  async markFailed(deliveryId: string, reason: string): Promise<void> {
    await this.txHost.tx
      .update(documentDelivery)
      .set({ status: "failed", failureReason: reason })
      .where(eq(documentDelivery.id, deliveryId));
  }
}
