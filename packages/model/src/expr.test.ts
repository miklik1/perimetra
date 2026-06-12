import { describe, expect, it } from "vitest";

import { evalNumber, evalString, evaluate, ExprError, parse, type Scope } from "./expr";

const scope: Scope = {
  opening_width_mm: 4000,
  panel_count: 3,
  suspension_angle: 35,
  "fill.dimension_type": "2D",
  "fill.min_spacing_mm": 101,
};

describe("Expr DSL — arithmetic & precedence", () => {
  it("respects operator precedence", () => {
    expect(evalNumber("2 + 3 * 4", {})).toBe(14);
    expect(evalNumber("(2 + 3) * 4", {})).toBe(20);
    expect(evalNumber("10 - 2 - 3", {})).toBe(5); // left-associative
  });

  it("evaluates references by dotted key", () => {
    expect(evalNumber("opening_width_mm - 100", scope)).toBe(3900);
    expect(evalNumber("(opening_width_mm - 100) / panel_count", scope)).toBe(1300);
    expect(evalNumber("fill.min_spacing_mm", scope)).toBe(101);
  });

  it("supports unary minus", () => {
    expect(evalNumber("-5 + 8", {})).toBe(3);
  });
});

describe("Expr DSL — functions", () => {
  it("floor / ceil / round / roundUp", () => {
    expect(evalNumber("floor(1205 / 101)", {})).toBe(11);
    expect(evalNumber("roundUp(43340 / 1000)", {})).toBe(44);
    expect(evalNumber("round(2214.36)", {})).toBe(2214);
  });

  it("min / max / clamp / roundTo", () => {
    expect(evalNumber("min(3, 7, 2)", {})).toBe(2);
    expect(evalNumber("max(3, 7, 2)", {})).toBe(7);
    expect(evalNumber("clamp(12, 0, 10)", {})).toBe(10);
    expect(evalNumber("roundTo(47, 5)", {})).toBe(45);
  });

  it("sinDeg matches the MVP's Math.sin((deg*PI)/180)", () => {
    // diagonal = round((postA - 50) / sinDeg(angle)); postA=1320, angle=35 → 2214.
    expect(evalNumber("round((1320 - 50) / sinDeg(35))", {})).toBe(2214);
  });

  it("if() is lazy and branch-selecting", () => {
    expect(evalNumber("if(panel_count == 2, 1.4, 1.333)", scope)).toBe(1.333);
    // The untaken branch is never evaluated (no division-by-zero here).
    expect(evalNumber("if(true, 1, 1 / 0)", {})).toBe(1);
  });
});

describe("Expr DSL — logic & comparison", () => {
  it("comparisons and booleans", () => {
    expect(evalString("opening_width_mm > 6000", scope)).toBe(false);
    expect(evalString('fill.dimension_type == "2D"', scope)).toBe(true);
    expect(evalString("panel_count == 2 && true", scope)).toBe(false);
  });

  it("short-circuits && and ||", () => {
    expect(evalString("false && (1 / 0 > 0)", {})).toBe(false);
    expect(evalString("true || (1 / 0 > 0)", {})).toBe(true);
  });
});

describe("Expr DSL — determinism & errors (I1/I5)", () => {
  it("is a pure function of (ast, scope)", () => {
    const ast = parse("opening_width_mm * 1.333");
    expect(evaluate(ast, scope)).toBe(evaluate(ast, scope));
  });

  it("throws on an unknown reference (never a silent zero)", () => {
    expect(() => evalNumber("nope + 1", {})).toThrow(ExprError);
  });

  it("throws on an unknown function", () => {
    expect(() => evalNumber("sqrt(4)", {})).toThrow(/Unknown function/);
  });

  it("throws on division by zero", () => {
    expect(() => evalNumber("1 / 0", {})).toThrow(/Division by zero/);
  });

  it("throws on a type mismatch", () => {
    expect(() => evalNumber('"x" + 1', {})).toThrow(ExprError);
  });
});
