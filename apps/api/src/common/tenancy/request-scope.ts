/**
 * The tenancy scope (ADR 0041 seam, ACTIVATED in ADR 0055). This is the one
 * narrow waist through which every per-tenant query is filtered:
 *
 * - Every repository METHOD takes a `RequestScope` and applies it to its
 *   WHERE clause (see `projects.repository.ts` — `scoped()` is the only
 *   place the filter is spelled). Repositories never read ambient request
 *   state; the scope arrives as an argument, so worker/system code paths
 *   are explicit, not accidental.
 * - Controllers obtain it via `@CurrentScope()` from the SessionGuard's
 *   session. The live scope is `organizationId` (org membership); `userId`
 *   rides along as the creator/audit ref on writes.
 *
 * Org scope is now REQUIRED: every user is auto-provisioned exactly one org
 * and every session is stamped with `activeOrganizationId` (ADR 0055 hooks in
 * `auth.instance.ts`). A session that somehow lacks an active org is a
 * fail-closed 403 (`@CurrentScope()`), never an unscoped query.
 *
 * Global vendor data (`release`, `catalog_version`) is intentionally NOT
 * scoped — it has no `RequestScope` and no `scoped()` filter.
 */

/** What a query is allowed to see. Resolved per request, passed explicitly. */
export interface RequestScope {
  /** Authenticated user — the creator/audit ref stamped on writes. */
  userId: string;
  /** Active organization — THE access scope every per-tenant query filters on. */
  organizationId: string;
}

/**
 * Structural slice of the SessionGuard's `SessionContext` — typed minimally
 * so `common/` does not depend on `modules/auth` (boundaries, ADR 0031).
 */
export interface SessionLike {
  user: { id: string };
  session: { activeOrganizationId?: string | null };
}

/**
 * Thrown when a session carries no active organization. Distinct type so the
 * `@CurrentScope()` decorator can translate it into a 403 without swallowing
 * unrelated errors.
 */
export class MissingOrganizationScopeError extends Error {
  constructor() {
    super("Session has no active organization");
    this.name = "MissingOrganizationScopeError";
  }
}

export function scopeFromSession(session: SessionLike): RequestScope {
  const organizationId = session.session.activeOrganizationId;
  if (!organizationId) {
    throw new MissingOrganizationScopeError();
  }
  return { userId: session.user.id, organizationId };
}
