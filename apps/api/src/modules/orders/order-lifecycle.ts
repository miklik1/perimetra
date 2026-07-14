/**
 * Order lifecycle (ADR 0109 / ADR-O1) — the state machine on top of the thin
 * reference entity. Like `quote-lifecycle.ts`, this is a pure, framework-free
 * leaf: action-specific predicates, no generic transition table, no I/O. The
 * order references a frozen quote snapshot; only its own `status` field moves:
 *
 *   (accepted quote) ──create──▶ confirmed ──start──▶ in_production ──complete──▶ completed
 *                                   │                       │
 *                                   └────── cancel ─────────┘   (admin, reason req'd)
 *                                              ▼
 *                                          cancelled  (terminal)
 *
 * `completed` and `cancelled` are terminal. Unlike a quote there is NO
 * clock-derived status (no `validUntil`/`expired` analogue): every status is
 * stored, and the actor gates (who may start/complete/cancel) live in the
 * service, not here.
 */
import type { OrderStatus } from "@repo/db/schema/orders";

/** Production may start only from a freshly `confirmed` order. */
export function canStart(status: OrderStatus): boolean {
  return status === "confirmed";
}

/** An order completes only from `in_production` (the workshop finished it). */
export function canComplete(status: OrderStatus): boolean {
  return status === "in_production";
}

/** Cancel is legal from either non-terminal state; a completed or already
 *  cancelled order is terminal and cannot be cancelled. */
export function canCancel(status: OrderStatus): boolean {
  return status === "confirmed" || status === "in_production";
}
