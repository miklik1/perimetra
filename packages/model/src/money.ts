/**
 * The I10 money boundary (ADR 0045/0048/0081): money LEAVES the engine as
 * decimal-as-string, never as a float. Internally the Expr/pricing domain stays
 * IEEE-754 (the delta-0 contract); the edge canonicalizes to **15 significant
 * decimal digits** — the convention under which the Excel-anchored goldens were
 * read off in the first place (Excel displays 15 sig digits), so the boundary
 * value IS the anchor value while sub-ulp float-accumulation noise
 * (81451.50399999999 vs 81451.504 — the same sum, one ulp of drift) can never
 * leak into an API/DB/PDF. {@link toMoneyString} is that noise-strip: it yields
 * the clean decimal the double *intended*, with NO commercial rounding.
 *
 * Commercial rounding (haléř vs whole-CZK, per-line vs end-of-invoice) is a
 * SEPARATE rule (ADR 0045's open check, resolved by ADR 0081): it lands as an
 * explicit {@link RoundingPolicy} ARGUMENT threaded from the price table, never
 * a hardcoded default. {@link roundMoney}/{@link addMoney}/{@link percentOf} do
 * EXACT decimal arithmetic (BigInt, no float re-rounding) over the clean
 * decimals — so a sum of money is exact and a rounded haléř amount is exact,
 * which is why decimal arithmetic legitimately moves the (sub-haléř) goldens
 * 81451.504 → 81451.5 etc. (the re-baseline, ADR 0081).
 *
 * Division of responsibility for the policy: the ENGINE money boundary applies
 * `scale`+`mode` to every emitted figure (per-line + each rolled-up total).
 * `granularity` (per-line vs end-of-invoice) governs how a TAX rate-base is
 * aggregated from line nets — a tax-layer concern ({@link "./tax.js"}), not the
 * engine's internal rollup.
 */
import type { MoneyString } from "./schema.js";

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

// --- Commercial rounding policy (ADR 0081) -----------------------------------

/** Half-up = round half away from zero (the CZ commercial default); half-even =
 *  banker's rounding. The accountant-gated choice (provisional default below). */
export type RoundingMode = "half-up" | "half-even";

/** Where rounding happens relative to summation when computing a tax rate base
 *  (a tax-layer concern, see {@link "./tax.js"}): `per-line` rounds each line to
 *  the money scale then sums; `end-of-invoice` sums the raw line nets then
 *  rounds the base once. They differ by at most a haléř and are an
 *  accountant-gated choice. */
export type RoundingGranularity = "per-line" | "end-of-invoice";

/** The commercial rounding rule, threaded from the price table (stamped via
 *  `priceTableVersion`, so a re-derived quote rounds identically — I3). NOT a
 *  hardcoded default: callers without a table fall back to
 *  {@link DEFAULT_ROUNDING_POLICY}, the documented provisional value. */
export interface RoundingPolicy {
  /** Decimal places money rounds to: 2 = haléř, 0 = whole CZK. */
  scale: number;
  mode: RoundingMode;
  granularity: RoundingGranularity;
}

/**
 * PROVISIONAL default — haléř (2dp), half-up, end-of-invoice. **Accountant-gated
 * (ADR 0081):** the real CZ policy (haléř vs whole-CZK for cash, half-up vs
 * half-even, per-line vs end-of-invoice for the VAT base) must be confirmed.
 * The value lives in data on the price table; this constant is only the
 * fallback for callers without a table (the configurator preview).
 */
export const DEFAULT_ROUNDING_POLICY: RoundingPolicy = {
  scale: 2,
  mode: "half-up",
  granularity: "end-of-invoice",
};

// --- Exact-decimal core (BigInt; no float re-rounding) ------------------------

/** A finite decimal as sign + integer coefficient + scale: value = (neg ? -1 :
 *  1) × coeff / 10^scale. Exact — all arithmetic below is on these, never on
 *  doubles. */
interface Dec {
  neg: boolean;
  coeff: bigint;
  scale: number;
}

/** Parse a clean decimal (a {@link MoneyString} or a finite double via
 *  {@link toMoneyString}) into an exact {@link Dec}. */
function toDec(value: number | MoneyString): Dec {
  const text = typeof value === "number" ? toMoneyString(value) : value;
  const neg = text.startsWith("-");
  const body = neg ? text.slice(1) : text;
  const dot = body.indexOf(".");
  if (dot === -1) {
    return { neg, coeff: BigInt(body === "" ? "0" : body), scale: 0 };
  }
  const intPart = body.slice(0, dot);
  const fracPart = body.slice(dot + 1);
  const digits = (intPart === "" ? "0" : intPart) + fracPart;
  return { neg, coeff: BigInt(digits === "" ? "0" : digits), scale: fracPart.length };
}

/** Render a {@link Dec} to the canonical {@link MoneyString}: shortest form, no
 *  trailing zeros, no trailing dot, "0" for zero, sign only when non-zero. */
function formatDec(d: Dec): MoneyString {
  if (d.coeff === 0n) return "0";
  let digits = d.coeff.toString();
  let out: string;
  if (d.scale === 0) {
    out = digits;
  } else {
    if (digits.length <= d.scale) digits = digits.padStart(d.scale + 1, "0");
    const cut = digits.length - d.scale;
    const frac = digits.slice(cut).replace(/0+$/, "");
    const int = digits.slice(0, cut);
    out = frac === "" ? int : `${int}.${frac}`;
  }
  return d.neg ? `-${out}` : out;
}

/** Align two {@link Dec}s to a common scale (the larger). */
function align(a: Dec, b: Dec): { ca: bigint; cb: bigint; scale: number } {
  const scale = Math.max(a.scale, b.scale);
  const ca = a.coeff * 10n ** BigInt(scale - a.scale);
  const cb = b.coeff * 10n ** BigInt(scale - b.scale);
  return { ca: a.neg ? -ca : ca, cb: b.neg ? -cb : cb, scale };
}

function addDec(a: Dec, b: Dec): Dec {
  const { ca, cb, scale } = align(a, b);
  const sum = ca + cb;
  return { neg: sum < 0n, coeff: sum < 0n ? -sum : sum, scale };
}

function mulDec(a: Dec, b: Dec): Dec {
  const coeff = a.coeff * b.coeff;
  return { neg: a.neg !== b.neg && coeff !== 0n, coeff, scale: a.scale + b.scale };
}

/** Exact round of a {@link Dec} to `scale` places under `mode` (half away from
 *  zero / banker's). The sign rides outside the magnitude, so half-up is always
 *  away-from-zero. */
function roundDec(d: Dec, scale: number, mode: RoundingMode): Dec {
  if (d.scale <= scale) {
    return { neg: d.neg, coeff: d.coeff * 10n ** BigInt(scale - d.scale), scale };
  }
  const drop = d.scale - scale;
  const divisor = 10n ** BigInt(drop);
  const q = d.coeff / divisor;
  const r = d.coeff % divisor;
  const twice = r * 2n;
  let rounded = q;
  if (mode === "half-up") {
    if (twice >= divisor) rounded = q + 1n;
  } else {
    // half-even
    if (twice > divisor) rounded = q + 1n;
    else if (twice === divisor && q % 2n === 1n) rounded = q + 1n;
  }
  return { neg: d.neg && rounded !== 0n, coeff: rounded, scale };
}

// --- Public exact-decimal money API ------------------------------------------

/** Round a money value to the policy's scale/mode — EXACT decimal (BigInt), not
 *  a float re-round. e.g. `roundMoney(31548.504, {scale:2,...})` → "31548.5"
 *  (haléř). The output is a trimmed {@link MoneyString}. */
export function roundMoney(value: number | MoneyString, policy: RoundingPolicy): MoneyString {
  return formatDec(roundDec(toDec(value), policy.scale, policy.mode));
}

/** Exact sum of money values — FULL precision (no rounding); the caller rounds
 *  the result if it is a boundary figure. */
export function addMoney(values: ReadonlyArray<number | MoneyString>): MoneyString {
  let acc: Dec = { neg: false, coeff: 0n, scale: 0 };
  for (const v of values) acc = addDec(acc, toDec(v));
  return formatDec(acc);
}

/** Exact product of two money/number values — full precision. */
export function mulMoney(a: number | MoneyString, b: number | MoneyString): MoneyString {
  return formatDec(mulDec(toDec(a), toDec(b)));
}

/** `base × ratePct / 100`, EXACT decimal, full precision (unrounded — the tax
 *  layer rounds the VAT amount to the policy). */
export function percentOf(base: number | MoneyString, ratePct: number | MoneyString): MoneyString {
  const product = mulDec(toDec(base), toDec(ratePct));
  // ÷100 = shift the scale up by 2 (exact).
  return formatDec({ ...product, scale: product.scale + 2 });
}
