/**
 * Reads the caller's role in their active organization (ADR 0056). The `member`
 * table is auth-module-owned schema (ADR 0032), so this is the ONLY place a
 * membership role is read — `RolesGuard` and any future role surface go through
 * here, never a cross-module join.
 *
 * The lookup is authoritative and fresh per request: the role lives in the DB,
 * not the session cookie, so an admin changing a member's role takes effect on
 * the member's NEXT request (no re-login). The read rides the ambient pooled
 * client (no `@Transactional()` around guards) — one indexed `(userId)` lookup.
 */
import { TransactionHost } from "@nestjs-cls/transactional";
import { type TransactionalAdapterDrizzleOrm } from "@nestjs-cls/transactional-adapter-drizzle-orm";
import { Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";

import { type Db } from "@repo/db";
import { member } from "@repo/db/schema/auth";

import { mapMemberRole, type OrgRole } from "../../common/rbac/org-role.js";
import { type RequestScope } from "../../common/tenancy/request-scope.js";

@Injectable()
export class MembershipService {
  constructor(private readonly txHost: TransactionHost<TransactionalAdapterDrizzleOrm<Db>>) {}

  /**
   * The caller's {@link OrgRole} in their ACTIVE org, or `null` when they hold no
   * membership there or the stored role is unmappable — callers fail closed on
   * `null`. Scoped on the exact `(userId, organizationId)` pair the session
   * resolved, so it can never read a role from a different org.
   */
  async resolveRole(scope: RequestScope): Promise<OrgRole | null> {
    const [row] = await this.txHost.tx
      .select({ role: member.role })
      .from(member)
      .where(and(eq(member.userId, scope.userId), eq(member.organizationId, scope.organizationId)))
      .limit(1);
    return row ? mapMemberRole(row.role) : null;
  }
}
