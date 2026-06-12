/**
 * Envelope mapping: a zod failure must surface through the (unchanged)
 * GlobalExceptionFilter as 422 `{ message, code: "validation", errors }`.
 */
import { type ArgumentsHost } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { GlobalExceptionFilter } from "../filters/global-exception.filter.js";
import { createValidationException, zodIssuesToFieldErrors } from "./validation-errors.js";

function failParse(schema: z.ZodType, value: unknown): z.ZodError {
  const result = schema.safeParse(value);
  if (result.success) throw new Error("expected parse failure");
  return result.error;
}

describe("zodIssuesToFieldErrors", () => {
  it("keys messages by dotted path and groups repeats per field", () => {
    const error = failParse(
      z.object({ name: z.string().min(1).max(3), nested: z.object({ flag: z.boolean() }) }),
      { name: "", nested: { flag: "nope" } },
    );

    const fields = zodIssuesToFieldErrors(error.issues);
    expect(Object.keys(fields).sort()).toEqual(["name", "nested.flag"]);
    expect(fields.name).toHaveLength(1);
    expect(typeof fields["nested.flag"]?.[0]).toBe("string");
  });

  it("keys root-level issues under _root", () => {
    const error = failParse(z.object({}), "not-an-object");
    expect(Object.keys(zodIssuesToFieldErrors(error.issues))).toEqual(["_root"]);
  });
});

describe("createValidationException", () => {
  it("builds a 422 whose response body is the ApiError envelope", () => {
    const error = failParse(z.object({ email: z.email() }), { email: "nope" });

    const exception = createValidationException(error);
    expect(exception.getStatus()).toBe(422);
    expect(exception.getResponse()).toMatchObject({
      message: "Validation failed",
      code: "validation",
      errors: { email: [expect.any(String)] },
    });
  });

  it("omits field errors for a non-zod error (still 422 validation)", () => {
    const exception = createValidationException(new Error("boom"));
    expect(exception.getStatus()).toBe(422);
    expect(exception.getResponse()).toEqual({
      message: "Validation failed",
      code: "validation",
    });
  });

  it("passes through GlobalExceptionFilter unchanged (no filter edits needed)", () => {
    const error = failParse(z.object({ email: z.email() }), { email: "nope" });

    const send = vi.fn();
    const status = vi.fn().mockReturnValue({ send });
    const host = {
      switchToHttp: () => ({ getResponse: () => ({ status, send }) }),
    } as unknown as ArgumentsHost;

    new GlobalExceptionFilter().catch(createValidationException(error), host);

    expect(status).toHaveBeenCalledWith(422);
    expect(send).toHaveBeenCalledWith({
      message: "Validation failed",
      code: "validation",
      errors: { email: [expect.any(String)] },
    });
  });
});
