/**
 * Deliveries' GDPR handler (ADR 0040/0071, ADR 0129). Two data subjects meet on
 * `document_delivery`, exactly as they do on `customer`:
 *  - the platform USER (the rep) via `ownerId` — who pressed send;
 *  - the BUYER (a third party) via `customerId` + the `pii()`-registered
 *    `recipientEmail`.
 *
 * This handler keys on the PLATFORM USER:
 *
 * - export (Art. 20): the rep's LINKAGE to the sends they made — ids, document
 *   type/number, status, timestamps. It MUST NOT return `recipientEmail`: that
 *   is a THIRD party's data and must never land in the rep's personal export
 *   (the `customers.privacy.ts` linkage-only rule, applied).
 * - erase (Art. 17): a documented, idempotent NO-OP. The delivery record is ORG
 *   data and the evidence of an outward commercial act; the rep's own PII is
 *   anonymized centrally on the Better Auth `user` row, after which the retained
 *   `ownerId` points at a PII-free principal (the ADR-0055 stance). The BUYER's
 *   erasure runs through the customer-keyed `DELETE /v1/customers/:id` →
 *   `anonymize` flow (ADR 0071) and is NOT this handler's job.
 *
 * OPEN QUESTION this handler deliberately does not answer: whether a buyer's
 * Art.17 request should ALSO scrub `recipient_email` on their historical
 * delivery rows. Today it does not — the address is retained as the evidence of
 * what was sent to whom — and after anonymization a live read structurally
 * disarms any FURTHER send (the address is nulled on the customer row, so the
 * send path 422s `customer_anonymized`). Settling the retention side is
 * accountant/legal-gated (CAR-27 pass 2) and is recorded in ADR 0129.
 *
 * NB the pii-contract test (`privacy-handlers.pii-contract.test.ts`) resolves
 * coverage by scanning THIS SOURCE for a direct named import of the table —
 * reaching it through the repository would not count.
 */
import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";

import { type Db } from "@repo/db";
import { documentDelivery } from "@repo/db/schema/deliveries";

import { DB } from "../../common/db/db.module.js";
import { type PrivacyHandler } from "../privacy/privacy.tokens.js";

@Injectable()
export class DeliveriesPrivacyHandler implements PrivacyHandler {
  readonly entityType = "documentDelivery";

  constructor(@Inject(DB) private readonly db: Db) {}

  async exportUser(userId: string): Promise<Record<string, unknown>> {
    // Linkage only — never `recipientEmail` (the buyer's data, a third party).
    const rows = await this.db
      .select({
        id: documentDelivery.id,
        documentType: documentDelivery.documentType,
        documentId: documentDelivery.documentId,
        documentNumber: documentDelivery.documentNumber,
        status: documentDelivery.status,
        sentAt: documentDelivery.sentAt,
        createdAt: documentDelivery.createdAt,
      })
      .from(documentDelivery)
      .where(eq(documentDelivery.ownerId, userId));
    return { documentDeliveries: rows };
  }

  async eraseUser(): Promise<void> {
    // Intentionally empty — org data retained as evidence of an outward act;
    // the rep's PII is anonymized on the user row centrally; the buyer's own
    // erasure is the customer DELETE flow. Idempotent (jobs retry).
  }
}
