/**
 * Customers repository (ADR 0082) — org-scoped (ADR 0055) with per-rep ownership
 * layered on top. `scoped(scope, {restrictToOwner})` ALWAYS filters by
 * `organizationId` (the access boundary) and live rows; when `restrictToOwner`
 * the rep sees only `ownerId = self` (sales), otherwise the whole org (admin).
 * The owner filter NEVER replaces the org filter.
 */
import { TransactionHost } from "@nestjs-cls/transactional";
import { type TransactionalAdapterDrizzleOrm } from "@nestjs-cls/transactional-adapter-drizzle-orm";
import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gt, ilike, isNull, lt, or } from "drizzle-orm";

import { type Db } from "@repo/db";
import { customer, type CustomerRow, type CustomerStatus } from "@repo/db/schema/customers";

import { type RequestScope } from "../../common/tenancy/request-scope.js";

export interface ListCustomersParams {
  cursor?: string | undefined;
  limit: number;
  sort: "createdAt:asc" | "createdAt:desc";
  status?: CustomerStatus | undefined;
  /** Free-text filter over name OR IČO (case-insensitive substring, CAR-23). */
  search?: string | undefined;
}

/** Escape ILIKE wildcards (`%`/`_`) so a literal search term can't pattern-match. */
function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export interface CustomersPageRows {
  items: CustomerRow[];
  nextCursor: string | null;
}

export interface InsertCustomerData {
  name: string;
  ico: string | null;
  dic: string | null;
  vatPayer: boolean;
  email: string | null;
  phone: string | null;
  addressLine: string | null;
  city: string | null;
  postalCode: string | null;
  country: string;
  note: string | null;
}

export type UpdateCustomerData = Partial<InsertCustomerData & { status: CustomerStatus }>;

interface ScopeOpts {
  /** When true (non-admin reps), narrow to the rep's own customers. */
  restrictToOwner: boolean;
}

@Injectable()
export class CustomersRepository {
  constructor(private readonly txHost: TransactionHost<TransactionalAdapterDrizzleOrm<Db>>) {}

  /** Org scope (always) + live rows + the optional per-rep owner narrowing. */
  private scoped(scope: RequestScope, opts: ScopeOpts) {
    return and(
      eq(customer.organizationId, scope.organizationId),
      isNull(customer.deletedAt),
      opts.restrictToOwner ? eq(customer.ownerId, scope.userId) : undefined,
    );
  }

  async list(
    scope: RequestScope,
    opts: ScopeOpts,
    params: ListCustomersParams,
  ): Promise<CustomersPageRows> {
    const ascending = params.sort === "createdAt:asc";
    const rows = await this.txHost.tx
      .select()
      .from(customer)
      .where(
        and(
          this.scoped(scope, opts),
          params.status ? eq(customer.status, params.status) : undefined,
          params.search
            ? or(
                ilike(customer.name, likePattern(params.search)),
                ilike(customer.ico, likePattern(params.search)),
              )
            : undefined,
          params.cursor
            ? ascending
              ? gt(customer.id, params.cursor)
              : lt(customer.id, params.cursor)
            : undefined,
        ),
      )
      .orderBy(ascending ? asc(customer.id) : desc(customer.id))
      .limit(params.limit + 1);

    const items = rows.slice(0, params.limit);
    const nextCursor = rows.length > params.limit ? (items.at(-1)?.id ?? null) : null;
    return { items, nextCursor };
  }

  async findById(
    scope: RequestScope,
    opts: ScopeOpts,
    customerId: string,
  ): Promise<CustomerRow | null> {
    const [row] = await this.txHost.tx
      .select()
      .from(customer)
      .where(and(this.scoped(scope, opts), eq(customer.id, customerId)))
      .limit(1);
    return row ?? null;
  }

  async insert(scope: RequestScope, data: InsertCustomerData): Promise<CustomerRow> {
    const [row] = await this.txHost.tx
      .insert(customer)
      .values({ ownerId: scope.userId, organizationId: scope.organizationId, ...data })
      .returning();
    return row!;
  }

  async update(
    scope: RequestScope,
    opts: ScopeOpts,
    customerId: string,
    patch: UpdateCustomerData,
  ): Promise<CustomerRow | null> {
    const [row] = await this.txHost.tx
      .update(customer)
      .set(patch)
      .where(and(this.scoped(scope, opts), eq(customer.id, customerId)))
      .returning();
    return row ?? null;
  }

  /**
   * GDPR "forget this customer" (buyer Art.17, ADR 0071): ANONYMIZE in place +
   * archive — never a hard delete. The buyer PII is scrubbed to sentinels while
   * the row survives, so an issued quote that froze a copy of the buyer fields
   * keeps re-deriving (quote.customer_id is ON DELETE RESTRICT, I3). Reversible
   * archiving (without scrubbing) is a `status` PATCH instead. True when a
   * scoped live row was anonymized.
   */
  async anonymize(scope: RequestScope, opts: ScopeOpts, customerId: string): Promise<boolean> {
    const rows = await this.txHost.tx
      .update(customer)
      .set({
        name: "[erased]",
        ico: null,
        dic: null,
        email: null,
        phone: null,
        addressLine: null,
        city: null,
        postalCode: null,
        note: null,
        status: "archived",
        deletedAt: new Date(),
      })
      .where(and(this.scoped(scope, opts), eq(customer.id, customerId)))
      .returning({ id: customer.id });
    return rows.length > 0;
  }
}
