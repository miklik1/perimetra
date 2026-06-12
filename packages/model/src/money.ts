/**
 * The I10 money boundary (ADR 0045/0048): money LEAVES the engine as
 * decimal-as-string, never as a float. Internally the Expr/pricing domain stays
 * IEEE-754 (the delta-0 contract); the edge canonicalizes to **15 significant
 * decimal digits** — the convention under which the Excel-anchored goldens were
 * read off in the first place (Excel displays 15 sig digits), so the boundary
 * value IS the anchor value while sub-ulp float-accumulation noise
 * (81451.50399999999 vs 81451.504 — the same sum, one ulp of drift) can never
 * leak into an API/DB/PDF. This is noise canonicalization, NOT a rounding
 * policy: haléř-level precision is untouched.
 *
 * Commercial rounding (haléře vs whole-CZK, per-line vs end-of-invoice) is a
 * separate rule pending extraction from the fabricator's real invoices — it
 * lands as an explicit policy argument, not a hardcoded default (ADR 0045's
 * open check).
 */
import type { MoneyString } from "./schema";

/** Format a computed price for the result boundary. Author/data bugs (NaN,
 *  Infinity, magnitudes with no plain decimal form) throw — a price that
 *  cannot be represented is never a user's fault (ADR 0047). */
export function toMoneyString(value: number): MoneyString {
  if (!Number.isFinite(value)) {
    throw new RangeError(`Money value must be finite, got ${String(value)}`);
  }
  // 15 significant digits (Excel display semantics — the goldens' provenance),
  // then shortest round-trip form. Normalize -0. Magnitudes that only have an
  // exponent-notation form are not prices — reject as corrupt data.
  const canonical = Number(value.toPrecision(15));
  const text = String(canonical === 0 ? 0 : canonical);
  if (text.includes("e") || text.includes("E")) {
    throw new RangeError(`Money value ${text} has no plain decimal form`);
  }
  return text;
}
