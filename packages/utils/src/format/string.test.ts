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
});

describe("slugify", () => {
  it("lowercases, strips diacritics, and dashes separators", () => {
    expect(slugify("Crème Brûlée!")).toBe("creme-brulee");
    expect(slugify("  Hello   World  ")).toBe("hello-world");
  });
});
