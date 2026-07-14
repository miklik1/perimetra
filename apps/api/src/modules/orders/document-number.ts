/**
 * The order number renderer (ADR 0109) — the ONE place an order's human handle
 * is formatted, so any surface that prints it reuses the same string. `Z`
 * prefix marks it operational (the workshop's handle), NOT a statutory tax
 * number (§29 gapless numbering governs invoices, not orders). The gap-free
 * sequence value comes from `NumberingService.allocate(scope, "order", year)`.
 */
const SEQ_PAD = 4;

export function formatOrderNumber(year: number, seq: number): string {
  return `Z${year}/${String(seq).padStart(SEQ_PAD, "0")}`;
}
