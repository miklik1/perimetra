import { describe, expect, it } from "vitest";

import { formatFileSize } from "./file-size";

describe("formatFileSize", () => {
  it("formats decimal units locale-aware", () => {
    expect(formatFileSize(1_200_000, {}, "en")).toBe("1.2 MB");
    expect(formatFileSize(1_200_000, {}, "cs")).toBe("1,2 MB");
    expect(formatFileSize(532, {}, "en")).toBe("532 byte");
    expect(formatFileSize(2_500, {}, "en")).toBe("2.5 kB");
  });

  it("formats binary units with an invariant IEC suffix", () => {
    expect(formatFileSize(1_536, { binary: true }, "en")).toBe("1.5 KiB");
    expect(formatFileSize(1_536, { binary: true }, "cs")).toBe("1,5 KiB");
    expect(formatFileSize(512, { binary: true }, "en")).toBe("512 B");
  });

  it("caps at the largest known unit and respects fraction digits", () => {
    expect(formatFileSize(10 ** 18, {}, "en")).toBe("1,000 PB");
    expect(formatFileSize(1_234_567, { maximumFractionDigits: 2 }, "en")).toBe("1.23 MB");
  });
});
