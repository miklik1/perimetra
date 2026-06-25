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
 * one digit. `.trim()` runs first so leading/trailing whitespace can't pad a
 * too-short (or whitespace-only) password up to `min(8)` — all length/regex
 * checks apply to the trimmed value. Each rule is its own check so the
 * error-map can report all unmet rules at once (RHF shows them per-field, ADR 0009).
 */
export const password = z.string().trim().min(8).max(128).regex(/[a-z]/).regex(/[A-Z]/).regex(/\d/);

/** E.164 international phone number (`+420123456789`). */
export const phoneE164 = z.e164();

/**
 * Absolute http(s) URL. `z.url()` validates URL *shape* via the WHATWG `URL`
 * constructor, which ALSO accepts `javascript:`, `data:`, and `ftp:` — a
 * stored-XSS vector once the value is rendered into an `<a href>` / `<img src>`.
 * The `protocol` constraint rejects every non-http(s) scheme at the contract
 * (defence at the trust boundary, not the render site) and emits the same
 * `invalid_format`/`url` issue as a malformed URL, so the ADR 0020 i18n
 * error-map translates it unchanged. (Channel-A drain from skeleton 40aa481.)
 */
export const url = z.url({ protocol: /^https?$/i });

/** URL-friendly slug: lowercase alphanumerics separated by single dashes. */
export const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

/** Strictly positive safe integer (ids, page numbers, counts). */
export const positiveInt = z.int().positive();

/**
 * Monetary amount: non-negative with at most two decimal places. `multipleOf`
 * is float-safe in zod (remainder computed on scaled integers).
 */
export const money = z.number().nonnegative().multipleOf(0.01);

/**
 * ISO 8601 datetime accepting UTC (`Z`) **and** timezone-offset (`+HH:MM`)
 * timestamps. Use this everywhere instead of bare `z.iso.datetime()`: the bare
 * form is Z-only in Zod 4 and rejects the offset/naive timestamps real backends
 * emit (Java `OffsetDateTime`, Postgres `timestamptz`, Go `time.Time`) — a
 * trust-boundary defect invisible in mock-first dev because fixtures serialize
 * via `toISOString()` (always `Z`). The `no-restricted-syntax` lint rule bans
 * the bare callsite so this is the single way to validate a wire timestamp.
 */
export const isoDatetime = z.iso.datetime({ offset: true });
