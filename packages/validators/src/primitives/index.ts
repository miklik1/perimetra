import { z } from "zod";

/**
 * Generic, reusable field-level schema primitives (Tier-B sweep). Message-
 * agnostic by design — translated messages come from the i18n zod error-map
 * (ADR 0020), so no hardcoded copy here. Czech locale-specific primitives live
 * in `./cz` behind an explicit import (`@repo/validators/primitives/cz`) so a
 * non-CZ project deletes one file.
 */

/**
 * Password policy: 8–128 chars with at least one lowercase, one uppercase and
 * one digit. Each rule is its own check so the error-map can report all unmet
 * rules at once (RHF shows them per-field, ADR 0009).
 */
export const password = z.string().min(8).max(128).regex(/[a-z]/).regex(/[A-Z]/).regex(/\d/);

/** E.164 international phone number (`+420123456789`). */
export const phoneE164 = z.e164();

/** Absolute URL (`https://…`). */
export const url = z.url();

/** URL-friendly slug: lowercase alphanumerics separated by single dashes. */
export const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

/** Strictly positive safe integer (ids, page numbers, counts). */
export const positiveInt = z.int().positive();

/**
 * Monetary amount: non-negative with at most two decimal places. `multipleOf`
 * is float-safe in zod (remainder computed on scaled integers).
 */
export const money = z.number().nonnegative().multipleOf(0.01);
