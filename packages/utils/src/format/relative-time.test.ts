import { describe, expect, it } from "vitest";

import { formatRelativeTime } from "./relative-time";

const base = new Date("2026-06-04T12:00:00Z");

describe("formatRelativeTime", () => {
  it("picks the largest sensible unit, past and future", () => {
    expect(formatRelativeTime(new Date("2026-06-04T10:00:00Z"), base, "en")).toBe("2 hours ago");
    expect(formatRelativeTime(new Date("2026-06-07T12:00:00Z"), base, "en")).toBe("in 3 days");
    expect(formatRelativeTime(new Date("2026-06-04T11:59:40Z"), base, "en")).toBe("20 seconds ago");
    expect(formatRelativeTime(new Date("2025-06-04T12:00:00Z"), base, "en")).toBe("last year");
  });

  it("rounds at unit boundaries instead of truncating", () => {
    // 1.9 days → "in 2 days", not "tomorrow".
    expect(formatRelativeTime(new Date("2026-06-06T09:36:00Z"), base, "en")).toBe("in 2 days");
    // 6.9 days rolls to the week unit.
    expect(formatRelativeTime(new Date("2026-06-11T09:36:00Z"), base, "en")).toBe("next week");
    // ~24h is "tomorrow", never the "in 24 hours" truncation artifact.
    expect(formatRelativeTime(new Date("2026-06-05T11:58:00Z"), base, "en")).toBe("tomorrow");
    // Symmetric in the past.
    expect(formatRelativeTime(new Date("2026-06-02T14:24:00Z"), base, "en")).toBe("2 days ago");
  });

  it("localizes to Czech", () => {
    expect(formatRelativeTime(new Date("2026-06-04T10:00:00Z"), base, "cs")).toBe(
      "před 2 hodinami",
    );
    expect(formatRelativeTime(new Date("2026-06-07T12:00:00Z"), base, "cs")).toBe("za 3 dny");
  });

  it("uses idiomatic phrasing via numeric:auto", () => {
    expect(formatRelativeTime(new Date("2026-06-03T12:00:00Z"), base, "en")).toBe("yesterday");
    expect(formatRelativeTime(new Date("2026-06-03T12:00:00Z"), base, "cs")).toBe("včera");
  });

  it("accepts Date, epoch and ISO-string inputs", () => {
    const twoHoursAgo = base.getTime() - 2 * 3_600_000;
    expect(formatRelativeTime(twoHoursAgo, base, "en")).toBe("2 hours ago");
    expect(formatRelativeTime("2026-06-04T10:00:00Z", base.getTime(), "en")).toBe("2 hours ago");
  });
});
