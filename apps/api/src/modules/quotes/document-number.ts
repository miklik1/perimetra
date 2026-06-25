/**
 * Quote document-number formatting (ADR 0079). Pure — the storage layer holds
 * the raw `(year, lastNumber)` counter; this is the one place that renders the
 * human/legal evidence number, so the tax layer + PDF reuse the same string.
 *
 * Format: `{year}/{seq:04d}` (e.g. `2026/0001`) — a per-year, gap-free series,
 * the conventional CZ shape for a nabídka. Invoices (Phase B) get their own
 * module/series; this one is quote-only.
 */
const SEQ_PAD = 4;

export function formatQuoteNumber(year: number, seq: number): string {
  return `${year}/${String(seq).padStart(SEQ_PAD, "0")}`;
}
