/**
 * Zod request/response semantics (ADR 0039, spec §8): the repo's single import
 * point for DTO + validation/serialization wiring. Controllers declare DTOs
 * with `createZodDto(schema)` and response shapes with `@ZodSerializerDto(Dto)`;
 * the providers below (installed globally by app.module) do the rest:
 *
 * - `APP_PIPE` → `ApiZodValidationPipe`: parses `@Body()`/`@Query()`/
 *   `@Param()` against the DTO's schema. Failures become the 422 ApiError
 *   envelope `{ message, code: "validation", errors }` via
 *   `createValidationException` (see `validation-errors.ts`) — the existing
 *   `GlobalExceptionFilter` forwards that body untouched, so the filter
 *   needs NO change.
 * - `APP_INTERCEPTOR` → `ZodSerializerInterceptor`: strips/validates response
 *   bodies against `@ZodSerializerDto(...)`. A serialization mismatch throws
 *   `ZodSerializationException` (a 500 `HttpException`) — the filter logs it
 *   and returns its opaque envelope, never the zod internals.
 *
 * Everything except the 422 exception factory is `nestjs-zod` v5 re-exported,
 * so this file stays the only place the dependency name appears.
 */
import { type Provider } from "@nestjs/common";
import { APP_INTERCEPTOR, APP_PIPE } from "@nestjs/core";
import { createZodValidationPipe, ZodSerializerInterceptor } from "nestjs-zod";

import { createValidationException } from "./validation-errors.js";

export { createZodDto, ZodSerializerDto } from "nestjs-zod";

/** Repo-configured pipe: identical to nestjs-zod's, with our 422 envelope.
 * (Internal — controllers never reference the pipe class; app.module installs
 * it via `apiSemanticsProviders`.) */
const ApiZodValidationPipe = createZodValidationPipe({
  createValidationException,
});

/**
 * Global API-semantics providers — the integrator spreads these into
 * app.module's `providers` (`...apiSemanticsProviders`).
 */
export const apiSemanticsProviders: Provider[] = [
  { provide: APP_PIPE, useClass: ApiZodValidationPipe },
  { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
];
