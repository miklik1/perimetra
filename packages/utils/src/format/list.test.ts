import { describe, expect, it } from "vitest";

import { formatList } from "./list";

describe("formatList", () => {
  it("joins with locale conjunctions", () => {
    expect(formatList(["a", "b", "c"], {}, "en")).toBe("a, b, and c");
    // Czech typography: U+00A0 follows the single-letter conjunction "a".
    expect(formatList(["a", "b", "c"], {}, "cs")).toBe("a, b a\u00A0c");
  });

  it("supports disjunction lists", () => {
    expect(formatList(["a", "b"], { type: "disjunction" }, "en")).toBe("a or b");
    expect(formatList(["a", "b"], { type: "disjunction" }, "cs")).toBe("a nebo b");
  });

  it("passes single items and empty lists through", () => {
    expect(formatList(["a"], {}, "en")).toBe("a");
    expect(formatList([], {}, "en")).toBe("");
  });
});
