import { describe, expect, it } from "vitest";

import type { ExprScope } from "@repo/model";

import {
  codeCandidates,
  completionCandidates,
  currentWord,
  exprStatus,
  formatExprValue,
  highlightSpans,
} from "./expr-authoring";

const scope: ExprScope = {
  known: new Set(["width_mm", "height_mm", "fill.spacing_mm"]),
  openPrefixes: ["price."],
};

describe("exprStatus", () => {
  it("is empty for blank input", () => {
    expect(exprStatus("  ", scope)).toEqual({ kind: "empty" });
  });

  it("is ok for an in-scope, well-formed expression", () => {
    expect(exprStatus("min(width_mm, height_mm) + 1", scope).kind).toBe("ok");
  });

  it("allows open-prefixed references (price.*)", () => {
    expect(exprStatus("price.alu * width_mm", scope).kind).toBe("ok");
  });

  it("surfaces a parse error with the exact DSL message", () => {
    const status = exprStatus("1 +", scope);
    expect(status.kind).toBe("parse-error");
    if (status.kind === "parse-error") expect(status.message).toMatch(/expression|Unexpected/i);
  });

  it("flags an out-of-scope reference", () => {
    const status = exprStatus("ghost + 1", scope);
    expect(status).toEqual({ kind: "ref-error", message: '"ghost" will not be in scope here' });
  });

  it("flags an unknown function", () => {
    const status = exprStatus("frobnicate(width_mm)", scope);
    expect(status).toEqual({
      kind: "ref-error",
      message: '"frobnicate()" is not a whitelisted function',
    });
  });
});

describe("currentWord", () => {
  it("extracts the dotted identifier ending at the caret", () => {
    expect(currentWord("min(fill.spa", 12)).toEqual({ word: "fill.spa", start: 4 });
  });

  it("is empty after a non-identifier char", () => {
    expect(currentWord("width + ", 8)).toEqual({ word: "", start: 8 });
  });
});

describe("completionCandidates", () => {
  it("offers in-scope names matching the partial word", () => {
    expect(completionCandidates(scope, "wid")).toContain("width_mm");
  });

  it("offers whitelisted functions suffixed with (", () => {
    expect(completionCandidates(scope, "ro")).toEqual(
      expect.arrayContaining(["round(", "roundTo(", "roundUp("]),
    );
  });

  it("offers open prefixes", () => {
    expect(completionCandidates(scope, "pri")).toContain("price.");
  });

  it("returns nothing for an empty word", () => {
    expect(completionCandidates(scope, "")).toEqual([]);
  });
});

describe("codeCandidates (catalog-code slots)", () => {
  const codes = ["jakl_30x30", "jakl_40x40", "L50x50"];

  it("offers all codes (quoted) for an empty word — surfaces the catalog on focus", () => {
    expect(codeCandidates(codes, "")).toEqual(['"L50x50"', '"jakl_30x30"', '"jakl_40x40"']);
  });

  it("filters by the bare word at the caret, case-insensitive, and quotes the result", () => {
    expect(codeCandidates(codes, "jakl")).toEqual(['"jakl_30x30"', '"jakl_40x40"']);
    expect(codeCandidates(codes, "l5")).toEqual(['"L50x50"']);
  });

  it("is empty when nothing matches", () => {
    expect(codeCandidates(codes, "steel")).toEqual([]);
  });
});

describe("highlightSpans (syntax overlay)", () => {
  const faithful = (src: string) =>
    expect(
      highlightSpans(src)
        .map((s) => s.text)
        .join(""),
    ).toBe(src);

  it("reconstructs the exact source (so the overlay aligns to the character)", () => {
    faithful('max(width_mm, 100) + fill.spacing_mm * 2 == "x"');
    faithful("  spaced   out  ");
    faithful("");
    faithful('"unterminated');
  });

  it("classifies the canonical token kinds", () => {
    const kinds = (src: string) => highlightSpans(src).map((s) => `${s.kind}:${s.text}`);
    expect(kinds("max(2)")).toEqual(["function:max", "punct:(", "number:2", "punct:)"]);
    expect(kinds("a + 1.5")).toEqual(["ident:a", "space: ", "operator:+", "space: ", "number:1.5"]);
    expect(kinds('true && "s"')).toEqual([
      "keyword:true",
      "space: ",
      "operator:&&",
      "space: ",
      'string:"s"',
    ]);
  });

  it("treats an identifier before `(` (even across spaces) as a function", () => {
    expect(highlightSpans("sinDeg (x)")[0]).toEqual({ text: "sinDeg", kind: "function" });
    expect(highlightSpans("width_mm")[0]).toEqual({ text: "width_mm", kind: "ident" });
  });
});

describe("formatExprValue (inline =value)", () => {
  it("renders integers plain and fractions trimmed", () => {
    expect(formatExprValue(1840)).toBe("1840");
    expect(formatExprValue(1.23456789)).toBe("1.2346");
  });

  it("quotes strings and passes booleans through", () => {
    expect(formatExprValue("alu")).toBe('"alu"');
    expect(formatExprValue(true)).toBe("true");
  });
});
