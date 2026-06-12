import { afterEach, describe, expect, it } from "vitest";

import { configureFlags, getFlags, resetFlags } from "./create-flags";
import { FLAGS } from "./registry";
import type { Flags } from "./types";

const fakeFlags = (value: boolean): Flags => ({
  isEnabled: () => value,
  getValue: () => value as never,
  getAll: () => ({ "example-flag": value }),
});

afterEach(() => {
  resetFlags();
});

describe("flags registry (composition root)", () => {
  it("serves registry defaults before configure", () => {
    expect(getFlags().isEnabled("example-flag")).toBe(FLAGS["example-flag"].default);
    expect(getFlags().getValue("example-flag")).toBe(FLAGS["example-flag"].default);
  });

  it("returns the configured adapter after boot", () => {
    const adapter = fakeFlags(false);
    configureFlags(adapter);
    expect(getFlags()).toBe(adapter);
  });

  it("is idempotent — the first configure wins (StrictMode/HMR safety)", () => {
    const first = fakeFlags(false);
    configureFlags(first);
    configureFlags(fakeFlags(true));
    expect(getFlags()).toBe(first);
  });

  it("resetFlags clears back to the static default", () => {
    configureFlags(fakeFlags(false));
    resetFlags();
    expect(getFlags().isEnabled("example-flag")).toBe(FLAGS["example-flag"].default);
  });
});
