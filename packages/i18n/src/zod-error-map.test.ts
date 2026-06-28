import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z, type ZodError } from "zod";

import { cs } from "./messages";
import { createZodErrorMap, installZodErrorMap, type Translator } from "./zod-error-map";

// A translator that echoes the key + args, so each assertion proves which
// catalog key was selected and which ICU params were forwarded.
const t: Translator = (key, values) => (values ? `${key} ${JSON.stringify(values)}` : key);
const map = createZodErrorMap(t);

/** Run the error map over the first issue of a failed parse. */
function mapFirstIssue(error: ZodError): string | undefined {
  const issue = error.issues[0]!;
  return map(issue as Parameters<typeof map>[0]) as string | undefined;
}

function failure(result: z.ZodSafeParseResult<unknown>): ZodError {
  if (result.success) throw new Error("expected the schema to reject the input");
  return result.error;
}

describe("createZodErrorMap", () => {
  it("maps invalid_type to errors.invalidType with the expected type", () => {
    const error = failure(z.string().safeParse(123));
    expect(mapFirstIssue(error)).toBe('errors.invalidType {"expected":"string"}');
  });

  it("maps too_small per origin (string / number / array)", () => {
    expect(mapFirstIssue(failure(z.string().min(3).safeParse("a")))).toBe(
      'errors.tooSmall.string {"minimum":3}',
    );
    expect(mapFirstIssue(failure(z.number().min(5).safeParse(1)))).toBe(
      'errors.tooSmall.number {"minimum":5}',
    );
    expect(mapFirstIssue(failure(z.array(z.string()).min(2).safeParse([])))).toBe(
      'errors.tooSmall.array {"minimum":2}',
    );
  });

  it("maps too_big to errors.tooBig with the maximum", () => {
    expect(mapFirstIssue(failure(z.string().max(2).safeParse("abcd")))).toBe(
      'errors.tooBig.string {"maximum":2}',
    );
  });

  it("maps invalid_format email to errors.invalidEmail", () => {
    expect(mapFirstIssue(failure(z.email().safeParse("nope")))).toBe("errors.invalidEmail");
  });

  it("maps not_multiple_of to errors.notMultipleOf with the divisor", () => {
    expect(mapFirstIssue(failure(z.number().multipleOf(3).safeParse(4)))).toBe(
      'errors.notMultipleOf {"divisor":3}',
    );
  });

  it("returns undefined for custom (.refine) issues so the schema message survives", () => {
    const schema = z.string().refine(() => false, "must be xyz");
    expect(mapFirstIssue(failure(schema.safeParse("a")))).toBeUndefined();
  });
});

// Boot-wiring smoke test: the map above is inert until installed with
// `z.config` (what the apps' ZodI18nBoot does). This drives the REAL
// `z.config` -> schema -> message path (not the map in isolation) and asserts a
// real Czech catalog string arrives — the regression guard the i18n-leak class
// needs (a passing map unit test proves nothing about the running app).
describe("zod error-map wiring (z.config)", () => {
  // Resolve a dotted catalog key against the real Czech messages (the keys
  // asserted here carry no ICU args, so a plain lookup is faithful).
  const csTranslate: Translator = (key) =>
    key
      .split(".")
      .reduce<unknown>(
        (node, part) => (node as Record<string, unknown> | undefined)?.[part],
        cs,
      ) as string;

  beforeAll(() => {
    installZodErrorMap(csTranslate);
  });
  afterAll(() => {
    // Reset the process-global so a customError never leaks past this file.
    z.config({ customError: () => undefined });
  });

  it("renders a real translated message at parse time once wired", () => {
    const result = z.email().safeParse("nope");
    expect(failure(result).issues[0]!.message).toBe(cs.errors.invalidEmail);
  });

  it("still lets a schema's own .refine message through (untranslated codes)", () => {
    const schema = z.string().refine(() => false, "must be xyz");
    expect(failure(schema.safeParse("a")).issues[0]!.message).toBe("must be xyz");
  });
});
