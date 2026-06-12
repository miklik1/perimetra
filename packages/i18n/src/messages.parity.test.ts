import { describe, expect, it } from "vitest";

import cs from "./messages/cs";
import en from "./messages/en";

/** Collect every leaf key path (e.g. `errors.tooSmall.string`), sorted. */
function leafKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj)
    .flatMap(([key, value]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      return typeof value === "object" && value !== null
        ? leafKeys(value as Record<string, unknown>, path)
        : [path];
    })
    .sort();
}

describe("catalog parity (ADR 0020)", () => {
  // `cs` is the type source-of-truth; this guards the locale the first product
  // does not render (`en`) from silently drifting out of key-parity with `cs`.
  it("en and cs expose the identical key set", () => {
    expect(leafKeys(en)).toEqual(leafKeys(cs));
  });
});
