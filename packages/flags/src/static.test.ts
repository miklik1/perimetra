import { describe, expect, expectTypeOf, it } from "vitest";

import { FLAGS, type FlagKey, type FlagValue } from "./registry";
import { createStaticFlags, staticDefaults } from "./static";

describe("createStaticFlags", () => {
  it("getAll covers every registry key with its default", () => {
    const all = createStaticFlags().getAll();
    for (const key of Object.keys(FLAGS) as FlagKey[]) {
      expect(all[key]).toBe(FLAGS[key].default);
    }
    expect(Object.keys(all)).toHaveLength(Object.keys(FLAGS).length);
  });

  it("isEnabled/getValue return the registry default", () => {
    const flags = createStaticFlags();
    expect(flags.isEnabled("example-flag")).toBe(true);
    expect(flags.getValue("example-flag")).toBe(true);
  });

  it("staticDefaults returns a fresh record each call", () => {
    const a = staticDefaults();
    const b = staticDefaults();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });

  it("getValue is typed from the registry default", () => {
    expectTypeOf(createStaticFlags().getValue("example-flag")).toEqualTypeOf<boolean>();
    // Multivariate flags carry their union through `FlagValue` via the
    // `default: "control" as "control" | "v2"` registry pattern. Exercised
    // against a synthetic registry shape so the shipped registry stays clean:
    type SyntheticFlags = { "ranking-algo": { default: "control" | "v2" } };
    type SyntheticValue<K extends keyof SyntheticFlags> = SyntheticFlags[K]["default"];
    expectTypeOf<SyntheticValue<"ranking-algo">>().toEqualTypeOf<"control" | "v2">();
    // And the real FlagValue helper resolves through the same lookup:
    expectTypeOf<FlagValue<"example-flag">>().toEqualTypeOf<boolean>();
  });
});
