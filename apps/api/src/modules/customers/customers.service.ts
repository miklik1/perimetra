/**
 * Customers service (ADR 0082) — org-scoped with per-rep ownership. A non-admin
 * rep (sales) sees only their own customers; admin sees the whole org. The
 * per-rep narrowing rides ON TOP of the org scope (`@CurrentScope()`), never
 * replacing it. Writes are `@Transactional()` (mutation + audit commit
 * together). DELETE anonymizes the buyer PII in place (ADR 0071) — never a hard
 * delete — so an issued quote that froze the buyer fields keeps re-deriving (I3).
 */
import { Transactional } from "@nestjs-cls/transactional";
import { Injectable, NotFoundException } from "@nestjs/common";

import { type CustomerRow } from "@repo/db/schema/customers";
import {
  type CreateCustomerInput,
  type Customer,
  type CustomersPage,
  type ListCustomersQuery,
  type UpdateCustomerInput,
} from "@repo/validators/customers";

import { type OrgRole } from "../../common/rbac/org-role.js";
import { type RequestScope } from "../../common/tenancy/request-scope.js";
import { AuditService } from "../audit/audit.service.js";
import {
  CustomersRepository,
  type InsertCustomerData,
  type UpdateCustomerData,
} from "./customers.repository.js";

/** Audited mutable surface (excludes the always-changing timestamps). */
const AUDITED_FIELDS = [
  "name",
  "ico",
  "dic",
  "vatPayer",
  "email",
  "phone",
  "addressLine",
  "city",
  "postalCode",
  "country",
  "note",
  "status",
] as const;

/** admin sees the whole org; every other rep is narrowed to their own rows. */
function scopeOpts(role: OrgRole): { restrictToOwner: boolean } {
  return { restrictToOwner: role !== "admin" };
}

function toCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    name: row.name,
    ico: row.ico,
    dic: row.dic,
    vatPayer: row.vatPayer,
    email: row.email,
    phone: row.phone,
    addressLine: row.addressLine,
    city: row.city,
    postalCode: row.postalCode,
    country: row.country,
    note: row.note,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function auditDiff(before: CustomerRow, after: CustomerRow) {
  const diff = { before: {} as Record<string, unknown>, after: {} as Record<string, unknown> };
  for (const field of AUDITED_FIELDS) {
    if (before[field] !== after[field]) {
      diff.before[field] = before[field];
      diff.after[field] = after[field];
    }
  }
  return diff;
}

function insertData(input: CreateCustomerInput): InsertCustomerData {
  return {
    name: input.name,
    ico: input.ico ?? null,
    dic: input.dic ?? null,
    vatPayer: input.vatPayer ?? false,
    email: input.email ?? null,
    phone: input.phone ?? null,
    addressLine: input.addressLine ?? null,
    city: input.city ?? null,
    postalCode: input.postalCode ?? null,
    country: input.country ?? "CZ",
    note: input.note ?? null,
  };
}

@Injectable()
export class CustomersService {
  constructor(
    private readonly customers: CustomersRepository,
    private readonly audit: AuditService,
  ) {}

  async list(
    scope: RequestScope,
    role: OrgRole,
    query: ListCustomersQuery,
  ): Promise<CustomersPage> {
    const { items, nextCursor } = await this.customers.list(scope, scopeOpts(role), query);
    return { items: items.map(toCustomer), nextCursor };
  }

  /** 404 covers both "doesn't exist" and "not yours/another rep's" — no oracle. */
  async get(scope: RequestScope, role: OrgRole, customerId: string): Promise<Customer> {
    const row = await this.customers.findById(scope, scopeOpts(role), customerId);
    if (!row) throw new NotFoundException("Customer not found");
    return toCustomer(row);
  }

  @Transactional()
  async create(scope: RequestScope, input: CreateCustomerInput): Promise<Customer> {
    const row = await this.customers.insert(scope, insertData(input));
    await this.audit.record({
      actorId: scope.userId,
      action: "customer.create",
      entityType: "customer",
      entityId: row.id,
      diff: { before: null, after: { name: row.name, vatPayer: row.vatPayer } },
    });
    return toCustomer(row);
  }

  @Transactional()
  async update(
    scope: RequestScope,
    role: OrgRole,
    customerId: string,
    input: UpdateCustomerInput,
  ): Promise<Customer> {
    const opts = scopeOpts(role);
    const before = await this.customers.findById(scope, opts, customerId);
    if (!before) throw new NotFoundException("Customer not found");

    const patch: UpdateCustomerData = {};
    for (const key of Object.keys(input) as (keyof UpdateCustomerInput)[]) {
      const value = input[key] ?? null;
      if (value !== before[key as keyof CustomerRow]) {
        (patch as Record<string, unknown>)[key] = value;
      }
    }
    if (Object.keys(patch).length === 0) return toCustomer(before);

    const row = await this.customers.update(scope, opts, customerId, patch);
    if (!row) throw new NotFoundException("Customer not found");
    await this.audit.record({
      actorId: scope.userId,
      action: "customer.update",
      entityType: "customer",
      entityId: customerId,
      diff: auditDiff(before, row),
    });
    return toCustomer(row);
  }

  /**
   * GDPR "forget" (buyer Art.17, ADR 0071): anonymize the buyer PII in place +
   * archive. Never cascades — issued quotes keep their frozen snapshot copies
   * (quote.customer_id RESTRICT). 404 when the scope owns no such live row.
   */
  @Transactional()
  async erase(scope: RequestScope, role: OrgRole, customerId: string): Promise<void> {
    const erased = await this.customers.anonymize(scope, scopeOpts(role), customerId);
    if (!erased) throw new NotFoundException("Customer not found");
    await this.audit.record({
      actorId: scope.userId,
      action: "customer.erase",
      entityType: "customer",
      entityId: customerId,
    });
  }
}
