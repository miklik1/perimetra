/**
 * The `@cardo/tax-cz` conformance SEATING gate (ADR 0112 §8, ADR 0009 discipline).
 *
 * Perimetra consumes the kernel's `buildInvoice`/VAT math directly rather than
 * re-deriving CZ tax, so this drives the kernel's OWN implementation
 * (`taxCzKernelImpl`) through the canonical legal vectors in Perimetra's CI. A
 * kernel version bump that would silently change §37 rounding, the §29
 * issuability gate, the per-group VAT recap, or the §92e legend trigger fails
 * THIS gate before adoption — the same drift-proof Mercata uses through its
 * cutover. `TAX_CZ_CONFORMANCE_VERSION` pins which legal vectors are asserted.
 */
import {
  formatViolations,
  runTaxCzConformance,
  TAX_CZ_CONFORMANCE_VERSION,
  taxCzKernelImpl,
} from "@cardo/tax-cz/conformance";
import { describe, expect, it } from "vitest";

describe("@cardo/tax-cz conformance (ADR 0112 §8)", () => {
  it("the installed kernel is 0-violation against the pinned legal vectors", () => {
    const violations = runTaxCzConformance(taxCzKernelImpl);
    expect(violations, formatViolations(violations)).toEqual([]);
  });

  it("pins the conformance vector version", () => {
    expect(TAX_CZ_CONFORMANCE_VERSION).toBe("0.1.0");
  });
});
