/**
 * Invoice evidenční číslo formatter (§29 odst. 1 písm. e, ADR 0112 §3). The
 * gap-free per-(org, "invoice", year) sequence is allocated by `NumberingService`
 * inside the issue transaction; this turns that value into the human/legal
 * series string.
 *
 * `FV{year}/{seq:04d}` (e.g. `FV2026/0007`) — PROVISIONAL, accountant-gated
 * (CAR-27 pass 1). This is a Perimetra-local per-class formatter, a sibling of
 * `formatQuoteNumber` (`{year}/{seq:04d}`) and `formatOrderNumber`
 * (`Z{year}/{seq:04d}`) — NOT the kernel's `formatDocumentNumber`, which emits a
 * pure DIGIT string for the variabilní symbol, not this `FV…/…` legal series.
 * The bank VS is derived separately via the kernel's `variableSymbolFromNumber`.
 */
const SEQ_PAD = 4;

export function formatInvoiceNumber(year: number, seq: number): string {
  return `FV${year}/${String(seq).padStart(SEQ_PAD, "0")}`;
}
