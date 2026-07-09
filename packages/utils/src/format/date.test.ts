import { describe, expect, it } from "vitest";

import { formatCalendarDate, formatDate, toIsoDate, toLocalIsoDate } from "./date";

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

describe("formatCalendarDate", () => {
  it("renders the UTC calendar day regardless of the instant's local offset", () => {
    // 02:00Z on the 22nd is still the 21st in any zone west of UTC by >2h —
    // asserted against an explicit western zone. formatCalendarDate pins UTC, so
    // it stays the 22nd on every machine (the exact shift the finding names).
    const instant = new Date("2026-06-22T02:00:00Z");
    const western = new Intl.DateTimeFormat("en-US", {
      dateStyle: "short",
      timeZone: "America/New_York",
    }).format(instant);
    expect(western).toBe("6/21/26");
    expect(formatCalendarDate(instant, { dateStyle: "short" }, "en-US")).toBe("6/22/26");
  });

  it("treats a bare YYYY-MM-DD string as that calendar day", () => {
    expect(formatCalendarDate("2026-06-22", { dateStyle: "short" }, "en-US")).toBe("6/22/26");
  });

  it("returns the empty string for an invalid date", () => {
    expect(formatCalendarDate("not-a-date", { dateStyle: "short" }, "en-US")).toBe("");
  });
});

describe("toLocalIsoDate", () => {
  it("returns the LOCAL calendar day, zero-padded", () => {
    // Built from LOCAL parts, so a Date constructed from local components
    // round-trips to the same Y-M-D on any machine.
    expect(toLocalIsoDate(new Date(2026, 0, 5, 0, 30))).toBe("2026-01-05");
  });

  it("keeps the local day where toIsoDate would roll to the UTC day", () => {
    // A local-midnight Date: toLocalIsoDate keeps the local day. (The contrast
    // with toIsoDate only shows under a non-UTC TZ, so we pin the local-parts
    // contract directly rather than depend on the runner's timezone.)
    const localMidnight = new Date(2026, 5, 22, 0, 15);
    expect(toLocalIsoDate(localMidnight)).toBe("2026-06-22");
  });

  it("returns the empty string for an invalid date", () => {
    expect(toLocalIsoDate(new Date("nonsense"))).toBe("");
  });
});
