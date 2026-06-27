/**
 * Org legal-profile schema (ADR 0088) — the fabricator's (dodavatel's) legal
 * identity, ONE row per organization. It supplies the supplier block of every
 * issued nabídka / daňový doklad (§29 ZDPH): name, IČO, DIČ, registered seat,
 * bank account, the court-registration note, and the VAT-payer flag that drives
 * the §92e reverse-charge decision (ADR 0080).
 *
 * Org-scoped (ADR 0055): `organizationId` is THE access scope, NOT NULL, and
 * UNIQUE — the row is a singleton per org (upsert, never a collection). `ownerId`
 * is the creator/last-editor audit ref only (RESTRICT, like customers: user
 * erasure anonymizes the user row in place rather than cascade-deleting org data).
 *
 * NOT PII: this is the fabricator's own BUSINESS identity, not a natural person's
 * personal data, so the columns are deliberately NOT `pii()`-wrapped (wrapping
 * would wrongly route org-identity into Art.17 erasure). FLAG (legal): for an
 * OSVČ sole trader the name/IČO ARE a natural person's data — if a statutory-rep
 * / contact-person field is later required by §29, THAT column must use `pii()`.
 *
 * The issued document does NOT read this row: `issue()` FREEZES a copy into the
 * immutable quote snapshot (ADR 0086 pattern), so editing the profile never
 * retro-alters an issued daňový doklad (I3).
 */
import { boolean, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

import { id, timestamps } from "../../columns.js";
import { organization, user } from "../auth/index.js";

export const legalProfile = pgTable(
  "legal_profile",
  {
    id: id(),
    /** THE access scope (ADR 0055) — NOT NULL + UNIQUE (one profile per org). */
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Creator / last editor (audit ref). RESTRICT so user erasure anonymizes the
     *  user row rather than cascade-deleting the org's legal identity (ADR 0055). */
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    /** Registered company / trade name (§29). */
    name: text("name").notNull(),
    /** IČO — Czech business identifier. */
    ico: text("ico"),
    /** DIČ — Czech VAT identifier ("CZ" + 8–10 digits). */
    dic: text("dic"),
    /** Registered VAT payer — load-bearing for the §92e decision (ADR 0080): a
     *  non-VAT-payer supplier can never issue a reverse-charge document. */
    vatPayer: boolean("vat_payer").notNull().default(false),
    /** Registered seat (sídlo). */
    addressLine: text("address_line"),
    city: text("city"),
    postalCode: text("postal_code"),
    /** ISO country (default CZ). */
    country: text("country").notNull().default("CZ"),
    /** Bank account for payment (CZ domestic or IBAN). */
    bankAccount: text("bank_account"),
    /** Court-registration note ("zapsáno v OR vedeném…", §435 NOZ) — free text. */
    registrationNote: text("registration_note"),
    ...timestamps(),
  },
  (table) => [
    // One profile per org — the conflict target the upsert keys on.
    uniqueIndex("legal_profile_org_id_uidx").on(table.organizationId),
  ],
);

export type LegalProfileRow = typeof legalProfile.$inferSelect;
export type NewLegalProfileRow = typeof legalProfile.$inferInsert;
