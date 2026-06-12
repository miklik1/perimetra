/**
 * Channel-naming convention (spec §7.3): `<scope>:<id>` —
 * - `user:<userId>` — personal channel; only that user may subscribe.
 * - `org:<orgId>`   — tenancy seam; authorization fills in with ADR 0041.
 * Domain semantics stay in the app (ADR 0029) — the api only authorizes and
 * publishes; the frontend `@repo/realtime` Centrifuge adapter consumes.
 */
export function userChannel(userId: string): string {
  return `user:${userId}`;
}
