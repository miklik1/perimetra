/**
 * The tenancy seam (ADR 0041, spec §6). Multi-tenancy is NOT built — this is
 * the one narrow waist that makes retrofitting it cheap:
 *
 * - Every repository METHOD takes a `RequestScope` and applies it to its
 *   WHERE clause (see `projects.repository.ts` — `scoped()` is the only
 *   place the filter is spelled). Repositories never read ambient request
 *   state; the scope arrives as an argument, so worker/system code paths
 *   are explicit, not accidental.
 * - Controllers obtain it via `@CurrentScope()` from the SessionGuard's
 *   session — today `userId` is the scope (owner-based authorization),
 *   `organizationId` rides along dormant.
 *
 * RETROFIT PLAYBOOK (when a project needs real multi-tenancy):
 *  1. Enable org creation in `auth.instance.ts`
 *     (`organization({ allowUserToCreateOrganization: true })`) and surface
 *     org switching — `session.activeOrganizationId` starts being non-null.
 *  2. Migrate domain tables: backfill `organization_id`, then flip it
 *     `NOT NULL` (expand → backfill → contract, ADR 0038).
 *  3. Change each repository's `scoped()` helper — ONE function per module —
 *     from `ownerId = scope.userId` to `organizationId =
 *     scope.organizationId` (plus role checks where ownership still
 *     matters). Nothing else in the module changes.
 *  4. Make `@CurrentScope()` REJECT sessions without an active organization
 *     (throw 403) instead of passing `organizationId: null`.
 *  5. Unlock `org:<id>` channels in `realtime.controller.ts` (membership
 *     check) and add `org:` cache-key prefixes where caching exists.
 */

/** What a query is allowed to see. Resolved per request, passed explicitly. */
export interface RequestScope {
  /** Authenticated user — today's ownership scope. */
  userId: string;
  /** Active organization — dormant until the ADR 0041 retrofit (step 4). */
  organizationId: string | null;
}

/**
 * Structural slice of the SessionGuard's `SessionContext` — typed minimally
 * so `common/` does not depend on `modules/auth` (boundaries, ADR 0031).
 */
export interface SessionLike {
  user: { id: string };
  session: { activeOrganizationId?: string | null };
}

export function scopeFromSession(session: SessionLike): RequestScope {
  return {
    userId: session.user.id,
    organizationId: session.session.activeOrganizationId ?? null,
  };
}
