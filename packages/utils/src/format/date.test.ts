import { describe, expect, it } from "vitest";

import { formatDate, toIsoDate } from "./date";

describe("formatDate", () => {
  it("formats a valid date for the given locale", () => {
    expect(formatDate(new Date("2026-06-22T00:00:00Z"), { dateStyle: "short" }, "en-US")).toBe(
      "6/22/26",
    );
  });

  it("returns the empty string for an invalid date", () => {
    expect(formatDate("not-a-date", { dateStyle: "short" }, "en-US")).toBe("");
    expect(formatDate(NaN, { dateStyle: "short" }, "en-US")).toBe("");
    expect(formatDate(new Date("nonsense"), { dateStyle: "short" }, "en-US")).toBe("");
  });
});

describe("toIsoDate", () => {
  it("returns the UTC date portion", () => {
    expect(toIsoDate(new Date("2026-06-22T12:34:56Z"))).toBe("2026-06-22");
  });

  it("returns the empty string for an invalid date", () => {
    expect(toIsoDate("not-a-date")).toBe("");
    expect(toIsoDate(NaN)).toBe("");
  });
});
