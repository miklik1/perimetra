import { z } from "zod";

/**
 * Czech locale-specific schema primitives (Tier-B sweep). Deliberately NOT
 * re-exported from the package barrel — import explicitly via
 * `@repo/validators/primitives/cz` so a non-CZ project deletes this one file.
 * Message-agnostic like the generic primitives (ADR 0020 error-map owns copy).
 */

/** Weighted checksum used by IČO and bank-account parts: Σ digit×weight mod 11. */
function weightedMod11(digits: string, weights: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    sum += Number(digits[digits.length - 1 - i]) * (weights[i] ?? 0);
  }
  return sum % 11;
}

// IČO weights right-to-left over the first 7 digits (i.e. 8..2 left-to-right).
const ICO_WEIGHTS = [2, 3, 4, 5, 6, 7, 8] as const;

/** IČO check digit: remainder r of the 8..2-weighted sum → check = (11−r) mod 10. */
function isValidIco(value: string): boolean {
  return Number(value[7]) === (11 - weightedMod11(value.slice(0, 7), ICO_WEIGHTS)) % 10;
}

/**
 * IČO — Czech company identification number: exactly 8 digits with a weighted
 * mod-11 check digit.
 */
export const ico = z
  .string()
  .regex(/^\d{8}$/)
  .refine(isValidIco);

/** DIČ — Czech VAT identifier: `CZ` followed by 8–10 digits. */
export const dic = z.string().regex(/^CZ\d{8,10}$/);

/** PSČ — Czech postal code: `NNN NN` (the space is optional). */
export const psc = z.string().regex(/^\d{3} ?\d{2}$/);

// Bank-account weights, applied right-to-left (ČNB decree 169/2011).
const BANK_WEIGHTS = [1, 2, 4, 8, 5, 10, 9, 7, 3, 6] as const;

/**
 * Czech domestic bank account: `[prefix-]number/bankcode`. Prefix (≤6 digits)
 * and number (2–10 digits) each carry their own right-to-left weighted mod-11
 * checksum; the bank code is 4 digits (registry membership is a runtime/API
 * concern, not validated here).
 */
export const bankAccount = z
  .string()
  .regex(/^(?:\d{1,6}-)?\d{2,10}\/\d{4}$/)
  .refine((value) => {
    const [account] = value.split("/") as [string];
    const [prefix, number] = account.includes("-")
      ? (account.split("-") as [string, string])
      : ["", account];
    if (prefix && weightedMod11(prefix, BANK_WEIGHTS) !== 0) return false;
    return weightedMod11(number, BANK_WEIGHTS) === 0;
  });

/** ISO 13616 mod-97 over the rearranged IBAN, letters mapped A=10…Z=35. */
function isValidIbanChecksum(value: string): boolean {
  const rearranged = value.slice(4) + value.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const part = char >= "A" ? String(char.charCodeAt(0) - 55) : char;
    for (const digit of part) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

/** Czech IBAN: `CZ` + 2 check digits + 20 digits (bank code, prefix, number). */
export const iban = z
  .string()
  .regex(/^CZ\d{22}$/)
  .refine(isValidIbanChecksum);

/** Calendar-day check; `Date.UTC(y, m, 0)` is the last day of month m (1-based). */
function isValidDay(year: number, month: number, day: number): boolean {
  return day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isValidRodneCislo(raw: string): boolean {
  const value = raw.replace("/", "");
  const yy = Number(value.slice(0, 2));
  const month = Number(value.slice(2, 4));
  const day = Number(value.slice(4, 6));
  // Strip the month offsets: +50 women, +20/+70 day-pool overflow variants
  // (issuance policy — e.g. the post-2004 rule — is NOT checked, only shape).
  const baseMonth =
    month > 70 ? month - 70 : month > 50 ? month - 50 : month > 20 ? month - 20 : month;
  if (baseMonth < 1 || baseMonth > 12) return false;
  if (value.length === 9) {
    // Nine-digit numbers were only issued to people born before 1954 — the
    // year is therefore unambiguous and the day can be calendar-checked.
    return yy < 54 && isValidDay(1900 + yy, baseMonth, day);
  }
  // Ten digits: years are unambiguous too (54–99 ⇒ 19YY, 00–53 ⇒ 20YY), so
  // leap years are well-defined for the calendar-day check.
  const year = yy >= 54 ? 1900 + yy : 2000 + yy;
  if (!isValidDay(year, baseMonth, day)) return false;
  // The whole number is divisible by 11, with the documented historical
  // exception (≈1954–1985) where remainder 10 paired with a trailing 0.
  const mod = [...value].reduce((acc, digit) => (acc * 10 + Number(digit)) % 11, 0);
  return mod === 0 || (mod === 10 && value.endsWith("0"));
}

/**
 * Rodné číslo — Czech national birth number (`YYMMDD/XXX(X)`, slash optional).
 * Validates format + calendar validity (real month/day incl. leap years — the
 * encoded century is unambiguous in both the 9- and 10-digit forms) + mod-11
 * checksum. It does NOT check issuance records or issuance-policy rules (e.g.
 * the +20/+70 windows being post-2004 only).
 *
 * **PII WARNING:** a rodné číslo identifies a person. Never log it, never put
 * it in error context, and never let a rejected candidate value reach an error
 * tracker — `@repo/telemetry`'s Sentry `beforeSend` scrubber redacts
 * RČ-shaped strings as the cross-package obligation created by shipping this
 * validator (ADR 0021).
 */
export const rodneCislo = z
  .string()
  .regex(/^\d{6}\/?\d{3,4}$/)
  .refine(isValidRodneCislo);
