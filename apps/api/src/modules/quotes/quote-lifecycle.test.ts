import { describe, expect, it } from "vitest";

import { QUOTE_STATUSES } from "@repo/db/schema/quotes";
import { QUOTE_STATUSES as VALIDATOR_QUOTE_STATUSES } from "@repo/validators/quotes";

import { canBuyerResolve, effectiveStatus } from "./quote-lifecycle.js";

const T0 = new Date("2026-06-26T12:00:00.000Z");
const PAST = new Date("2026-06-25T12:00:00.000Z");
const FUTURE = new Date("2026-12-31T12:00:00.000Z");

describe("effectiveStatus — expiry derived from validUntil (ADR 0083)", () => {
  it("an issued quote past validUntil reads as expired", () => {
    expect(effectiveStatus("issued", PAST, T0)).toBe("expired");
  });

  it("an issued quote before validUntil (or with none) stays issued", () => {
    expect(effectiveStatus("issued", FUTURE, T0)).toBe("issued");
    expect(effectiveStatus("issued", null, T0)).toBe("issued");
  });

  it("validUntil exactly now counts as expired (boundary)", () => {
    expect(effectiveStatus("issued", T0, T0)).toBe("expired");
  });

  it("accepted/declined are terminal — they never expire", () => {
    expect(effectiveStatus("accepted", PAST, T0)).toBe("accepted");
    expect(effectiveStatus("declined", PAST, T0)).toBe("declined");
  });
});

describe("canBuyerResolve — only an effectively-issued quote", () => {
  it("permits accept/decline only from issued", () => {
    expect(canBuyerResolve("issued")).toBe(true);
    expect(canBuyerResolve("accepted")).toBe(false);
    expect(canBuyerResolve("declined")).toBe(false);
    expect(canBuyerResolve("expired")).toBe(false);
  });

  /** Exhaustive over the tuple, so a status ADDED later cannot silently become
   *  buyer-resolvable without this test being updated deliberately. */
  it("refuses every status other than issued", () => {
    for (const status of QUOTE_STATUSES.filter((s) => s !== "issued")) {
      expect(canBuyerResolve(status)).toBe(false);
    }
  });
});

/** ADR 0127 (superseding ADR 0083:27-29) — `draft` was provably unwritable and
 *  is gone from the vocabulary. This pins the removal at BOTH mirrors: a
 *  re-added `draft` must be a deliberate decision, not a merge accident. The
 *  `satisfies`-checked OPEN_QUOTE_STATUSES in quotes.repository.ts is the third
 *  leg (it is a compile error there, not a runtime one). */
describe("QUOTE_STATUSES — the `draft` status is removed (ADR 0127)", () => {
  it("carries exactly issued/accepted/declined/expired, in lockstep", () => {
    expect([...QUOTE_STATUSES]).toEqual(["issued", "accepted", "declined", "expired"]);
    expect(QUOTE_STATUSES).not.toContain("draft");
    // The @repo/validators tuple is the wire half of the same vocabulary.
    expect([...VALIDATOR_QUOTE_STATUSES]).toEqual([...QUOTE_STATUSES]);
  });
});
