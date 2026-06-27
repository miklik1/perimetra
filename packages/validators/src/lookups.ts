/**
 * Registry-lookup contracts (ADR 0090) — the api↔frontend seam for IČO→ARES
 * prefill and DIČ→VIES validation. READ-ONLY convenience: the api proxies the
 * public CZ ARES register and the EU VIES VAT-validation service, shapes the
 * result, and FAILS SOFT (an upstream outage degrades to `unavailable`, never an
 * error that blocks manual customer entry). No persistence, no PII stored — these
 * are lookup KEYS against public registers, not a buyer record.
 *
 * The input primitives (`ico`/`dic`) are the same CZ checksums the customer +
 * legal-profile contracts use, re-exported here so the api can reject a malformed
 * key BEFORE spending upstream quota (a client error, not a fail-soft outcome).
 */
import { z } from "zod";

import { dic, ico } from "./primitives/cz";

/** IČO validator — exactly the customer/legal-profile rule (8 digits + mod-11).
 *  Re-exported so the web can gate its prefill button on the SAME checksum. */
export const lookupIcoSchema = ico;
/** DIČ validator — `CZ` + 8–10 digits (the §92e VAT identifier). */
export const lookupDicSchema = dic;

/**
 * POST request bodies. The lookup KEY travels in the BODY, never the URL — so it
 * stays out of the request log (pino-http logs `req.url` but NOT the body, and a
 * body field named after a `pii()` column is redacted regardless) and out of
 * browser history / proxy access logs. The schemas are lenient (`z.string`);
 * the service runs the real IČO/DIČ validation so a malformed key is a precise
 * `400 invalid_ico` / `invalid_dic`, not a generic 422.
 */
export const aresLookupRequestSchema = z.object({ ico: z.string().min(1).max(16) });
export type AresLookupRequest = z.infer<typeof aresLookupRequestSchema>;
export const viesLookupRequestSchema = z.object({ dic: z.string().min(1).max(16) });
export type ViesLookupRequest = z.infer<typeof viesLookupRequestSchema>;

/** Registered seat (sídlo), mapped from ARES into the customer/legal-profile address shape. */
export const aresAddressSchema = z.object({
  line: z.string().nullable(),
  city: z.string().nullable(),
  postalCode: z.string().nullable(),
  country: z.string(),
});
export type AresAddress = z.infer<typeof aresAddressSchema>;

export const ARES_STATUSES = ["found", "not_found", "unavailable"] as const;
export const VIES_STATUSES = ["valid", "invalid", "unavailable"] as const;

/**
 * ARES subject lookup by IČO. The subject fields are OPTIONAL and populate ONLY
 * when `status === "found"` — the service never sets them on `not_found`/
 * `unavailable`, so a degraded lookup carries no subject data (a flat object,
 * not a discriminated union, because nestjs-zod's `createZodDto` cannot extend a
 * union type — the strip-serializer + the service are the no-leak guarantors).
 * `found` is informational only (MF ČR data is not legal evidence); `dissolved`
 * flags a `datumZaniku` so the rep sees a defunct subject before prefilling.
 */
export const aresLookupSchema = z.object({
  status: z.enum(ARES_STATUSES),
  ico: z.string().optional(),
  name: z.string().optional(),
  dic: z.string().nullable().optional(),
  address: aresAddressSchema.optional(),
  dissolved: z.boolean().optional(),
});
export type AresLookup = z.infer<typeof aresLookupSchema>;

/**
 * VIES VAT-number validation. `unavailable` is DELIBERATELY distinct from
 * `invalid`: a member-state registry outage (`MS_UNAVAILABLE`) or a timeout must
 * never read as a bad number — that would wrongly deny the §92e both-parties-
 * VAT-payer condition. `name`/`address` populate only on a confirmed `valid`.
 */
export const viesLookupSchema = z.object({
  status: z.enum(VIES_STATUSES),
  name: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
});
export type ViesLookup = z.infer<typeof viesLookupSchema>;
