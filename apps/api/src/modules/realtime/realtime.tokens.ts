/**
 * Channel-naming convention (spec §7.3): `<scope>:<id>` —
 * - `user:<userId>` — personal channel; only that user may subscribe.
 * - `org:<orgId>`   — tenant channel; only members of the session's active org
 *   may subscribe (ADR 0055 activated the seam — membership = active org).
 * Domain semantics stay in the app (ADR 0029) — the api only authorizes and
 * publishes; the frontend `@repo/realtime` Centrifuge adapter consumes.
 */
export function userChannel(userId: string): string {
  return `user:${userId}`;
}

export function orgChannel(organizationId: string): string {
  return `org:${organizationId}`;
}
