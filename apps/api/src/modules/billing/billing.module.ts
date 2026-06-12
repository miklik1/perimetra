import { Module } from "@nestjs/common";

import { BILLING_PROVIDER } from "./billing.tokens.js";
import { NoopBillingProvider } from "./noop-billing.provider.js";

/**
 * Billing seam (spec §7.6, ADR 0034): binds `BILLING_PROVIDER` to the Noop
 * implementation. Nothing imports this module yet BY DESIGN — when a project
 * adopts a provider it imports BillingModule where billing is consumed,
 * injects `@Inject(BILLING_PROVIDER) provider: BillingProvider`, and swaps
 * the `useClass` for its adapter (the ONE line that changes). The webhook
 * ingestion half is a recipe, not code — see README.md.
 */
@Module({
  providers: [{ provide: BILLING_PROVIDER, useClass: NoopBillingProvider }],
  exports: [BILLING_PROVIDER],
})
export class BillingModule {}
