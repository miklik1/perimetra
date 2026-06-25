import { describe, expect, it } from "vitest";

import { decodeConfig, encodeConfig, type SharedConfig } from "./config-hash";

describe("config-hash", () => {
  const config: SharedConfig = {
    releaseId: "sliding-gate@1",
    input: {
      opening_width_mm: 4000,
      clear_height_mm: 1500,
      fill_type_id: "planka_100_2d",
      include_motor: true,
    },
  };

  it("round-trips a configuration losslessly", () => {
    expect(decodeConfig(encodeConfig(config))).toEqual(config);
  });

  it("produces a URL-safe token (no +, /, or = padding)", () => {
    expect(encodeConfig(config)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("returns null on a malformed token instead of throwing", () => {
    expect(decodeConfig("not-valid-base64!!!")).toBeNull();
    expect(decodeConfig("")).toBeNull();
  });

  it("returns null on a well-formed token of the wrong shape", () => {
    const bogus = encodeConfig({ wrong: true } as unknown as SharedConfig);
    expect(decodeConfig(bogus)).toBeNull();
  });
});
