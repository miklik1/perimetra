import { z } from "zod";

/**
 * Runtime contract for the error envelope a backend returns on a non-2xx
 * response. `@repo/api` parses non-OK bodies against this to build its
 * normalized `ApiError`.
 */
export const apiErrorEnvelopeSchema = z.object({
  message: z.string(),
  code: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
  /**
   * Field-level validation errors keyed by form field path, e.g.
   * `{ email: ["already taken"] }`. Surfaced as `ApiError.fieldErrors` so RHF
   * can call `setError` per field (ADR 0009/0014).
   */
  errors: z.record(z.string(), z.array(z.string())).optional(),
});

export type ApiErrorEnvelope = z.infer<typeof apiErrorEnvelopeSchema>;
