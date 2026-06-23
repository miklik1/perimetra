import { describe, expect, it } from "vitest";

import { safeNextPath } from "./safe-redirect";

describe("safeNextPath", () => {
  it("accepts bare same-origin paths (with query and hash)", () => {
    expect(safeNextPath("/account")).toBe("/account");
    expect(safeNextPath("/")).toBe("/");
    expect(safeNextPath("/account/settings?tab=billing")).toBe("/account/settings?tab=billing");
    expect(safeNextPath("/projects#top")).toBe("/projects#top");
  });

  it("rejects empty / nullish input", () => {
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath("")).toBeNull();
  });

  it("rejects absolute URLs and scheme tricks", () => {
    expect(safeNextPath("https://evil.com")).toBeNull();
    expect(safeNextPath("http://localhost/account")).toBeNull();
    expect(safeNextPath("javascript:alert(1)")).toBeNull();
    expect(safeNextPath("mailto:x@y.z")).toBeNull();
  });

  it("rejects protocol-relative and backslash open-redirect payloads", () => {
    expect(safeNextPath("//evil.com")).toBeNull();
    expect(safeNextPath("/\\evil.com")).toBeNull();
    expect(safeNextPath("/\\/evil.com")).toBeNull();
  });

  it("rejects paths without a leading slash (including leading whitespace)", () => {
    expect(safeNextPath("account")).toBeNull();
    expect(safeNextPath(" /account")).toBeNull();
    expect(safeNextPath("\t/account")).toBeNull();
  });

  it("rejects embedded control chars the URL parser would strip into an open redirect", () => {
    // `/<TAB>//evil.com` passes the prefix guards but the URL parser strips the
    // tab → `//evil.com`. Rejected at the control-char gate (and the origin check).
    expect(safeNextPath("/\t//evil.com")).toBeNull();
    expect(safeNextPath("/\n//evil.com")).toBeNull();
    expect(safeNextPath("/foo\r\nbar")).toBeNull();
  });
});
