import { type ApiErrorEnvelope } from "@repo/validators";

import { MockHttpError, type MockResponse } from "./types";

/**
 * Error body shaped to `apiErrorEnvelopeSchema`, so a mocked failure is parsed
 * by `@repo/api`'s transport into the same normalized `ApiError` a real backend
 * error would produce.
 */
export function errorEnvelope(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): ApiErrorEnvelope {
  // Omitted rather than set to `undefined` so the body a handler produces is
  // key-for-key what a real backend sends — an envelope with an explicit
  // `details: undefined` survives an in-process assertion but not JSON, and the
  // two mock transports (BFF route handler vs MSW) differ on exactly that.
  return { message, code, ...(details !== undefined ? { details } : {}) };
}

/** Normalize a thrown handler error into a status + envelope response. */
export function dispatchMockError(error: unknown): MockResponse {
  if (error instanceof MockHttpError) {
    return {
      status: error.status,
      body: errorEnvelope(error.code, error.message, error.details),
      headers: {},
    };
  }
  // Detect a ZodError structurally so this package needn't depend on zod.
  if (error && typeof error === "object" && (error as { name?: string }).name === "ZodError") {
    return { status: 422, body: errorEnvelope("VALIDATION_ERROR", "Invalid request"), headers: {} };
  }
  const message = error instanceof Error ? error.message : "Mock handler error";
  return { status: 500, body: errorEnvelope("INTERNAL", message), headers: {} };
}
