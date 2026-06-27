/**
 * Org legal-profile contracts (ADR 0088) — the api↔frontend seam for the
 * fabricator's (dodavatel's) legal identity. A SINGLETON per org: a `GET`
 * response (nullable — a fresh org has no profile yet) + a full-document `PUT`
 * upsert body. No list/pagination/status (it is not a collection).
 *
 * Identifying fields use the CZ primitives on INPUT (strict IČO/DIČ/bank
 * checksums) but the response stays lenient strings (stored values are not
 * re-validated on read). This is BUSINESS identity, not personal PII — the DB
 * columns are deliberately not `pii()`-wrapped (ADR 0088).
 */
import { z } from "zod";

import { isoDatetime } from "./primitives";
import { bankAccount, dic, ico } from "./primitives/cz";

/** Response shape — what the legal-profile endpoint serializes through (strip semantics). */
export const legalProfileSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(200),
  ico: z.string().nullable(),
  dic: z.string().nullable(),
  vatPayer: z.boolean(),
  addressLine: z.string().nullable(),
  city: z.string().nullable(),
  postalCode: z.string().nullable(),
  country: z.string(),
  bankAccount: z.string().nullable(),
  registrationNote: z.string().nullable(),
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
});
export type LegalProfile = z.infer<typeof legalProfileSchema>;

/** GET response — wraps the profile so a not-yet-completed org serializes as
 *  `{ profile: null }` (an honest empty state) rather than a 404. */
export const legalProfileResponseSchema = z.object({
  profile: legalProfileSchema.nullable(),
});
export type LegalProfileResponse = z.infer<typeof legalProfileResponseSchema>;

/** Full-document PUT body (upsert). `name` is the one required field — a daňový
 *  doklad cannot omit the supplier name; everything else fills in over time. */
export const upsertLegalProfileSchema = z.object({
  name: z.string().min(1).max(200),
  ico: ico.nullable().optional(),
  dic: dic.nullable().optional(),
  vatPayer: z.boolean().optional(),
  addressLine: z.string().max(200).nullable().optional(),
  city: z.string().max(120).nullable().optional(),
  postalCode: z.string().max(20).nullable().optional(),
  country: z.string().length(2).optional(),
  bankAccount: bankAccount.nullable().optional(),
  registrationNote: z.string().max(500).nullable().optional(),
});
export type UpsertLegalProfileInput = z.infer<typeof upsertLegalProfileSchema>;
