/**
 * Price-tables service (ADR 0053) — publish + resolve per-tenant versioned
 * price tables. `publish` is `@Transactional()` (insert + audit commit
 * together). No update/delete: a stamped version is immutable (I3), so
 * re-publishing a version is a 409. `resolveActive` is the effective-date
 * lookup quote-issue and the configurator resolve a table through — it MAY use
 * the wall clock (app-layer; the engine stays pure).
 *
 * Append-only audit on every price mutation is the CORE_SPEC §7 requirement.
 */
import { Transactional } from "@nestjs-cls/transactional";
import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";

import { type PriceTableRow } from "@repo/db/schema/price-tables";
import {
  type ListPriceTablesQuery,
  type PriceTableData,
  type PriceTableDetail,
  type PriceTablesPage,
  type PriceTableSummary,
  type PublishPriceTableInput,
} from "@repo/validators/price-tables";

import { type RequestScope } from "../../common/tenancy/request-scope.js";
import { AuditService } from "../audit/audit.service.js";
import { PriceTablesRepository } from "./price-tables.repository.js";

function toSummary(row: PriceTableRow): PriceTableSummary {
  return {
    id: row.id,
    version: row.version,
    currency: row.currency,
    effectiveFrom: row.effectiveFrom.toISOString(),
    effectiveTo: row.effectiveTo ? row.effectiveTo.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toDetail(row: PriceTableRow): PriceTableDetail {
  return {
    ...toSummary(row),
    marginFloorPct: row.marginFloorPct,
    dphRate: row.dphRate,
    reverseCharge: row.reverseCharge,
    table: row.table as PriceTableData,
  };
}

@Injectable()
export class PriceTablesService {
  constructor(
    private readonly priceTables: PriceTablesRepository,
    private readonly audit: AuditService,
  ) {}

  async list(scope: RequestScope, query: ListPriceTablesQuery): Promise<PriceTablesPage> {
    const { items, nextCursor } = await this.priceTables.list(scope, query);
    return { items: items.map(toSummary), nextCursor };
  }

  async get(scope: RequestScope, priceTableId: string): Promise<PriceTableDetail> {
    const row = await this.priceTables.findById(scope, priceTableId);
    if (!row) throw new NotFoundException("Price table not found");
    return toDetail(row);
  }

  /** The table active at `asOf` (defaults to now). 404 when the tenant has no
   *  table covering the instant — never a silent empty price layer (I5). */
  async resolveActive(scope: RequestScope, asOf?: Date): Promise<PriceTableDetail> {
    const row = await this.priceTables.resolveActive(scope, asOf ?? new Date());
    if (!row) throw new NotFoundException("No active price table for the given date");
    return toDetail(row);
  }

  /** Cross-module: the stamped version's detail — quote reproduction (I3)
   *  reloads the exact immutable table the stamp points at. */
  async loadByVersion(scope: RequestScope, version: number): Promise<PriceTableDetail | null> {
    const row = await this.priceTables.findByVersion(scope, version);
    return row ? toDetail(row) : null;
  }

  // TODO(roles slice 6.3g): gate to the admin role. Authenticated-only for now.
  @Transactional()
  async publish(scope: RequestScope, input: PublishPriceTableInput): Promise<PriceTableDetail> {
    const version = input.table.version;
    const existing = await this.priceTables.findByVersion(scope, version);
    if (existing) {
      throw new ConflictException(`price table version ${version} already exists (immutable, I3)`);
    }
    const row = await this.priceTables.insert(scope, {
      version,
      currency: input.currency,
      effectiveFrom: new Date(input.effectiveFrom),
      effectiveTo: input.effectiveTo ? new Date(input.effectiveTo) : null,
      marginFloorPct: input.marginFloorPct ?? null,
      dphRate: input.dphRate,
      reverseCharge: input.reverseCharge ?? false,
      table: input.table,
    });
    await this.audit.record({
      actorId: scope.userId,
      action: "price-table.publish",
      entityType: "price-table",
      entityId: row.id,
      diff: { before: null, after: { version, currency: input.currency } },
    });
    return toDetail(row);
  }
}
