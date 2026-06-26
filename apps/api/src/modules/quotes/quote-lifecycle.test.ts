import { describe, expect, it } from "vitest";

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
    expect(canBuyerResolve("draft")).toBe(false);
  });
});
