/**
 * Cross-tenant organization reads for the platform/vendor console (ADR 0062).
 * The `organization` table is auth-module-owned schema (ADR 0032), so — like the
 * membership role — this is the ONLY place a cross-tenant org list is read; the
 * platform module reaches it through this exported service, never a join.
 *
 * Reachable ONLY behind `PlatformGuard` (the platform controller), so the
 * cross-tenant read never crosses the per-org `scoped()` seam.
 */
import { TransactionHost } from "@nestjs-cls/transactional";
import { type TransactionalAdapterDrizzleOrm } from "@nestjs-cls/transactional-adapter-drizzle-orm";
import { Injectable } from "@nestjs/common";
import { desc, eq } from "drizzle-orm";

import { type Db } from "@repo/db";
import { organization } from "@repo/db/schema/auth";
import { type PlatformOrganization } from "@repo/validators/platform";

@Injectable()
export class OrganizationsService {
  constructor(private readonly txHost: TransactionHost<TransactionalAdapterDrizzleOrm<Db>>) {}

  /** Every tenant org, newest first. Vendor-scale (a handful of fabricators) —
   *  unpaginated for now; revisit with keyset pagination if the tenant count grows. */
  async listAll(): Promise<PlatformOrganization[]> {
    const rows = await this.txHost.tx
      .select({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        createdAt: organization.createdAt,
      })
      .from(organization)
      .orderBy(desc(organization.createdAt));
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  }

  /** Whether an org exists — the platform assign path 404s a bogus id before the
   *  assignment FK would otherwise fire a raw DB error. */
  async exists(organizationId: string): Promise<boolean> {
    const [row] = await this.txHost.tx
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1);
    return row !== undefined;
  }
}
