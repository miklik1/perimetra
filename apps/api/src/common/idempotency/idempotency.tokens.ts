/**
 * DI token in its own file (auth.tokens.ts pattern) so the interceptor never
 * imports `idempotency.module.ts` — that cycle would evaluate the module
 * decorator before the token exists.
 */
export const IDEMPOTENCY_REDIS = Symbol("IDEMPOTENCY_REDIS");
