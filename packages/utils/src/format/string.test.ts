import { describe, expect, it } from "vitest";

import { capitalize, slugify, truncate } from "./string";

describe("capitalize", () => {
  it("uppercases the first character", () => {
    expect(capitalize("hello")).toBe("Hello");
    expect(capitalize("")).toBe("");
  });
});

describe("truncate", () => {
  it("cuts and appends an ellipsis past the limit", () => {
    expect(truncate("hello world", 5)).toBe("hello…");
  });

  it("leaves short strings untouched", () => {
    expect(truncate("hi", 5)).toBe("hi");
  });

  it("respects grapheme clusters instead of splitting emoji", () => {
    // UTF-16 `.slice(0, 2)` would cut "a👍b" to "a\uD83D" (a broken surrogate).
    expect(truncate("a👍b", 2)).toBe("a👍…");
    // A ZWJ family emoji is one grapheme (8 UTF-16 units); keep it whole.
    expect(truncate("👨‍👩‍👧x", 1)).toBe("👨‍👩‍👧…");
    // A short multi-unit string that fits by grapheme count is untouched.
    expect(truncate("👍👍", 2)).toBe("👍👍");
  });
});

describe("slugify", () => {
  it("lowercases, strips diacritics, and dashes separators", () => {
    expect(slugify("Crème Brûlée!")).toBe("creme-brulee");
    expect(slugify("  Hello   World  ")).toBe("hello-world");
  });
});
