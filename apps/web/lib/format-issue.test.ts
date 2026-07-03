import { describe, expect, it } from "vitest";

import type { Issue } from "@repo/engine";

import { formatIssue, type IssueTranslator } from "./format-issue";

/**
 * A tiny in-memory translator: `{name}` substitution only, no real ICU. It
 * exercises `formatIssue`'s OWN logic (known-key lookup, ICU-value coercion,
 * optional-fragment appending, the unknown-key fallback) in isolation from the
 * real catalog's content — catalog COMPLETENESS is the enumeration test's job
 * (`format-issue.coverage.test.ts`), catalog ICU VALIDITY is `@repo/i18n`'s
 * own tests'. Keeping `formatIssue` taking `t` as a plain param (not a React
 * hook) is what makes this fake substitutable at all (CAR-14).
 */
function fakeTranslator(messages: Record<string, string>): IssueTranslator {
  const t = ((key: string, values?: Record<string, string>) => {
    const template = messages[key];
    if (template === undefined) throw new Error(`no message for "${key}"`);
    return template.replace(/\{(\w+)\}/g, (_match, name: string) => values?.[name] ?? `{${name}}`);
  }) as IssueTranslator;
  t.has = (key: string) => key in messages;
  return t;
}

describe("formatIssue", () => {
  it("renders a known key with its params interpolated", () => {
    const t = fakeTranslator({ "engine.input.above_max": "{key} exceeds {max} (got {value})" });
    const issue: Issue = {
      key: "engine.input.above_max",
      severity: "error",
      scope: "instance",
      params: { key: "opening_width_mm", max: 8000, value: 12000 },
    };
    expect(formatIssue(t, issue)).toBe("opening_width_mm exceeds 8000 (got 12000)");
  });

  it("renders a known key that carries no params", () => {
    const t = fakeTranslator({ "sliding.opening_width.wide": "Too wide." });
    const issue: Issue = { key: "sliding.opening_width.wide", severity: "warn", scope: "instance" };
    expect(formatIssue(t, issue)).toBe("Too wide.");
  });

  it("String()-coerces non-string params (numbers, booleans) before interpolating", () => {
    const t = fakeTranslator({ "engine.override.bad_value": "bad value: {value}" });
    const issue: Issue = {
      key: "engine.override.bad_value",
      severity: "error",
      scope: "instance",
      params: { id: "o1", value: true },
    };
    expect(formatIssue(t, issue)).toBe("bad value: true");
  });

  it("appends an optional fragment (e.g. note) when the param is present", () => {
    const t = fakeTranslator({
      "engine.deviation.out_of_bounds": "{key} out of {min}-{max}.",
      "fragment.note": " Note: {note}",
    });
    const issue: Issue = {
      key: "engine.deviation.out_of_bounds",
      severity: "error",
      scope: "instance",
      params: { key: "opening_width_mm", value: 9500, min: 1800, max: 9000, note: "checked" },
    };
    expect(formatIssue(t, issue)).toBe("opening_width_mm out of 1800-9000. Note: checked");
  });

  it("omits the optional fragment entirely when the param is absent", () => {
    const t = fakeTranslator({
      "engine.deviation.out_of_bounds": "{key} out of {min}-{max}.",
      "fragment.note": " Note: {note}",
    });
    const issue: Issue = {
      key: "engine.deviation.out_of_bounds",
      severity: "error",
      scope: "instance",
      params: { key: "opening_width_mm", value: 9500, min: 1800, max: 9000 },
    };
    expect(formatIssue(t, issue)).toBe("opening_width_mm out of 1800-9000.");
  });

  it("falls back to a generic sentence for an uncatalogued (vendor-custom) key, carrying key + params", () => {
    const t = fakeTranslator({
      unknown: 'Unknown issue "{key}".',
      "fragment.params": " ({params})",
    });
    const issue: Issue = {
      key: "vendor.custom.thing",
      severity: "warn",
      scope: "instance",
      params: { foo: "bar", n: 3 },
    };
    expect(formatIssue(t, issue)).toBe('Unknown issue "vendor.custom.thing". (foo: bar, n: 3)');
  });

  it("falls back without a trailing params clause when there are no params", () => {
    const t = fakeTranslator({ unknown: 'Unknown issue "{key}".' });
    const issue: Issue = { key: "vendor.custom.thing", severity: "warn", scope: "instance" };
    expect(formatIssue(t, issue)).toBe('Unknown issue "vendor.custom.thing".');
  });

  it("never throws for an uncatalogued key, even without an `unknown` entry registered", () => {
    const t = fakeTranslator({});
    const issue: Issue = { key: "totally.unknown", severity: "error", scope: "site" };
    // `t.has` correctly reports false; formatIssue still calls through to `t`,
    // whose behavior on a missing key is the catalog's concern, not this
    // module's — the real catalog always carries `issues.unknown` (asserted by
    // the enumeration test). This test only proves formatIssue routes to the
    // fallback path instead of the direct lookup.
    expect(() => formatIssue(fakeTranslator({ unknown: "x" }), issue)).not.toThrow();
    expect(t.has(issue.key)).toBe(false);
  });
});
