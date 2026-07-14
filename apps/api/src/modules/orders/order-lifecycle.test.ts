import { describe, expect, it } from "vitest";

import { canCancel, canComplete, canStart } from "./order-lifecycle.js";

describe("canStart — production starts only from confirmed (ADR 0109)", () => {
  it("permits start only from confirmed", () => {
    expect(canStart("confirmed")).toBe(true);
    expect(canStart("in_production")).toBe(false);
    expect(canStart("completed")).toBe(false);
    expect(canStart("cancelled")).toBe(false);
  });
});

describe("canComplete — completes only from in_production (ADR 0109)", () => {
  it("permits complete only from in_production", () => {
    expect(canComplete("confirmed")).toBe(false);
    expect(canComplete("in_production")).toBe(true);
    expect(canComplete("completed")).toBe(false);
    expect(canComplete("cancelled")).toBe(false);
  });
});

describe("canCancel — cancel from either non-terminal state (ADR 0109)", () => {
  it("permits cancel from confirmed and in_production, never from a terminal state", () => {
    expect(canCancel("confirmed")).toBe(true);
    expect(canCancel("in_production")).toBe(true);
    expect(canCancel("completed")).toBe(false);
    expect(canCancel("cancelled")).toBe(false);
  });
});
