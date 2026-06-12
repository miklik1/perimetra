import { describe, expect, it } from "vitest";

import { DEFAULT_LOCALE, isLocale, LOCALES } from "./config";
import { getMessages } from "./messages";
import cs from "./messages/cs";
import en from "./messages/en";

describe("isLocale", () => {
  it("accepts every supported locale", () => {
    for (const locale of LOCALES) expect(isLocale(locale)).toBe(true);
  });

  it("rejects unknown values, region tags, null and undefined", () => {
    expect(isLocale("de")).toBe(false);
    expect(isLocale("cs-CZ")).toBe(false);
    expect(isLocale("")).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
});

describe("getMessages", () => {
  it("returns the catalog for a known locale", () => {
    expect(getMessages("cs")).toBe(cs);
    expect(getMessages("en")).toBe(en);
  });

  it("falls back to DEFAULT_LOCALE for an unknown value", () => {
    expect(DEFAULT_LOCALE).toBe("cs");
    // @ts-expect-error — exercising the defensive runtime fallback for a value
    // that bypassed `isLocale` narrowing.
    expect(getMessages("xx")).toBe(getMessages(DEFAULT_LOCALE));
  });
});
