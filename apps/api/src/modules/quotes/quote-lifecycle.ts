/**
 * Quote lifecycle (ADR 0083) — the legal status transitions on top of the I3
 * immutable snapshot. The SNAPSHOT never changes once issued; only the `status`
 * field moves, through guarded transitions:
 *
 *   draft ──issue──▶ issued ──accept (buyer/shareToken)──▶ accepted
 *                       │
 *                       └──decline (buyer/shareToken)─────▶ declined
 *
 * `expired` is DERIVED, never stored: an `issued` quote whose `validUntil` has
 * passed READS as expired (so no cron/worker is needed, and the lapse is exact).
 * An accepted/declined quote is terminal — it does NOT expire (the deal already
 * resolved). The buyer can only act on a quote that is *effectively* `issued`
 * (live, not lapsed, not already resolved).
 */
import type { QuoteStatus } from "@repo/db/schema/quotes";

/**
 * The status a quote effectively HAS right now: a still-`issued` quote past its
 * `validUntil` is `expired`. Everything else is its stored status. Pure (the
 * clock is passed in) so reads are deterministic for a given instant.
 */
export function effectiveStatus(
  status: QuoteStatus,
  validUntil: Date | null,
  now: Date,
): QuoteStatus {
  if (status === "issued" && validUntil !== null && validUntil.getTime() <= now.getTime()) {
    return "expired";
  }
  return status;
}

/** A buyer action (accept/decline) is legal ONLY from an effectively-issued
 *  quote — never from an already-accepted/declined or lapsed one. */
export function canBuyerResolve(effective: QuoteStatus): boolean {
  return effective === "issued";
}
