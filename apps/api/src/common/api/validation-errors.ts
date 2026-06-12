/**
 * Zod-issue → ApiError-envelope mapping (spec §8, ADR 0014/0030): request
 * validation failures surface as 422 `{ message, code: "validation",
 * errors: { field: [msgs] } }` — the exact shape `@repo/validators`'
 * `apiErrorEnvelopeSchema` declares, so RHF can `setError` per field.
 *
 * Kept free of `nestjs-zod` imports on purpose: the mapping is pure
 * `@nestjs/common`, so it stays unit-testable independently of the pipe that
 * invokes it (see `zod.ts` for the wiring).
 */
import { UnprocessableEntityException, type HttpException } from "@nestjs/common";

interface ZodIssueLike {
  path: PropertyKey[];
  message: string;
}

/**
 * Structural narrow instead of `instanceof ZodError`: nestjs-zod supports
 * both zod classic and `zod/v4/core` errors, and a dual-package instanceof
 * would silently miss one of them.
 */
function isZodErrorLike(error: unknown): error is { issues: ZodIssueLike[] } {
  if (typeof error !== "object" || error === null) return false;
  const issues = (error as { issues?: unknown }).issues;
  return (
    Array.isArray(issues) &&
    issues.every(
      (issue: unknown) =>
        typeof issue === "object" &&
        issue !== null &&
        Array.isArray((issue as ZodIssueLike).path) &&
        typeof (issue as ZodIssueLike).message === "string",
    )
  );
}

/** Root-level issues (empty path — e.g. "expected object") key under `_root`. */
const ROOT_FIELD = "_root";

export function zodIssuesToFieldErrors(issues: ZodIssueLike[]): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of issues) {
    const field =
      issue.path.length > 0 ? issue.path.map((segment) => String(segment)).join(".") : ROOT_FIELD;
    (fieldErrors[field] ??= []).push(issue.message);
  }
  return fieldErrors;
}

/**
 * `createValidationException` for nestjs-zod's `createZodValidationPipe`.
 * Returns a plain `UnprocessableEntityException` whose response body already
 * IS the ApiError envelope — `GlobalExceptionFilter` passes `message`/`code`/
 * `errors` through verbatim for any `HttpException`, so no filter change is
 * needed.
 */
export function createValidationException(error: unknown): HttpException {
  return new UnprocessableEntityException({
    message: "Validation failed",
    code: "validation",
    ...(isZodErrorLike(error) ? { errors: zodIssuesToFieldErrors(error.issues) } : {}),
  });
}
