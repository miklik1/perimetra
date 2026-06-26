/**
 * Customers' GDPR handler (ADR 0040/0071). Two data subjects meet in this table:
 * the platform USER (the rep — `ownerId`, an audit ref) and the BUYER (the
 * odběratel — the PII columns). This handler keys on the PLATFORM USER:
 *
 * - export (Art. 20): the rep's linkage to the customers they created (ids +
 *   timestamps) — NOT the buyer PII, which is a THIRD party's data and must not
 *   land in the rep's personal export.
 * - erase (Art. 17): NO-OP. The customers are ORG data (retained for co-members
 *   + any issued quotes); the rep's own PII is anonymized centrally on the Better
 *   Auth `user` row, after which the retained `ownerId` points at a PII-free
 *   principal (the ADR-0055 stance). The BUYER's own erasure is a separate,
 *   customer-keyed flow (the DELETE endpoint → `anonymize`, ADR 0071) — it does
 *   not run here.
 *
 * Exact export shape + the buyer-erasure surface are accountant/legal-gated
 * (flagged in ADR 0082).
 */
import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";

import { type Db } from "@repo/db";
import { customer } from "@repo/db/schema/customers";

import { DB } from "../../common/db/db.module.js";
import { type PrivacyHandler } from "../privacy/privacy.tokens.js";

@Injectable()
export class CustomersPrivacyHandler implements PrivacyHandler {
  readonly entityType = "customer";

  constructor(@Inject(DB) private readonly db: Db) {}

  async exportUser(userId: string): Promise<Record<string, unknown>> {
    // Linkage only — never the buyer PII (a third party's), which the rep's
    // personal export must not carry.
    const rows = await this.db
      .select({ id: customer.id, createdAt: customer.createdAt })
      .from(customer)
      .where(eq(customer.ownerId, userId));
    return { customers: rows };
  }

  async eraseUser(): Promise<void> {
    // Intentionally empty — org data retained; the rep's PII is anonymized on
    // the user row centrally; the buyer's own erasure is the DELETE flow.
    // Idempotent (jobs retry).
  }
}
