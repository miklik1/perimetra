import { describe, expect, it } from "vitest";
import { z, type ZodError } from "zod";

import { createZodErrorMap, type Translator } from "./zod-error-map";

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
