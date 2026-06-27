/**
 * Legal-profiles repository (ADR 0088) — a SINGLETON per org. `scoped()` filters
 * on `organizationId` (THE access scope, ADR 0055); there is no per-rep narrowing
 * (the org has ONE legal identity, shared by every member) and no pagination.
 * `upsert` keys on the org unique index — create-or-replace in one statement.
 */
import { TransactionHost } from "@nestjs-cls/transactional";
import { type TransactionalAdapterDrizzleOrm } from "@nestjs-cls/transactional-adapter-drizzle-orm";
import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";

import { type Db } from "@repo/db";
import { legalProfile, type LegalProfileRow } from "@repo/db/schema/legal-profiles";

import { type RequestScope } from "../../common/tenancy/request-scope.js";

/** The full mutable column set an upsert writes (excludes id/org/owner/timestamps). */
export interface UpsertLegalProfileData {
  name: string;
  ico: string | null;
  dic: string | null;
  vatPayer: boolean;
  addressLine: string | null;
  city: string | null;
  postalCode: string | null;
  country: string;
  bankAccount: string | null;
  registrationNote: string | null;
}

@Injectable()
export class LegalProfilesRepository {
  constructor(private readonly txHost: TransactionHost<TransactionalAdapterDrizzleOrm<Db>>) {}

  /** The org access scope (ADR 0055) — the singleton's only filter. */
  private scoped(scope: RequestScope) {
    return eq(legalProfile.organizationId, scope.organizationId);
  }

  /** The org's profile, or null when it has not been completed yet. */
  async find(scope: RequestScope): Promise<LegalProfileRow | null> {
    const [row] = await this.txHost.tx
      .select()
      .from(legalProfile)
      .where(this.scoped(scope))
      .limit(1);
    return row ?? null;
  }

  /**
   * Create-or-replace the org's singleton profile. Keys on the org unique index
   * (`legal_profile_org_id_uidx`): a first PUT inserts, every later PUT replaces
   * the whole document (the form submits all fields). `ownerId` is re-stamped to
   * the editing user on each write (last-editor audit ref).
   */
  async upsert(scope: RequestScope, data: UpsertLegalProfileData): Promise<LegalProfileRow> {
    const [row] = await this.txHost.tx
      .insert(legalProfile)
      .values({ organizationId: scope.organizationId, ownerId: scope.userId, ...data })
      .onConflictDoUpdate({
        target: legalProfile.organizationId,
        set: { ownerId: scope.userId, updatedAt: new Date(), ...data },
      })
      .returning();
    return row!;
  }
}
