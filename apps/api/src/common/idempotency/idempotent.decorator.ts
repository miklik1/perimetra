import { SetMetadata, type CustomDecorator } from "@nestjs/common";

export const IDEMPOTENT_METADATA_KEY = "idempotent";

/**
 * Opt a route (or a whole controller) into Idempotency-Key handling (spec §8).
 * `IdempotencyInterceptor` is global but inert everywhere else — only
 * `@Idempotent()` handlers pay the Redis round-trips.
 *
 * ```ts
 * @Post()
 * @Idempotent()
 * create(@Body() body: CreateProjectDto) { ... }
 * ```
 *
 * AUTHORIZATION INVARIANT (load-bearing): every access check that gates an
 * `@Idempotent()` route MUST run in a **guard**, never in the handler/service
 * or a downstream interceptor. On a key replay the interceptor returns the
 * stored response WITHOUT invoking the handler (see `IdempotencyInterceptor`),
 * so any in-handler check is skipped — but guards run BEFORE all interceptors,
 * so a guard still gates the replay. Enforcing entitlement/quota/ownership at
 * the handler layer here is the fleet's idempotency-replay authorization-bypass
 * class: a caller whose access was revoked after the first success could replay
 * the cached body and skip the now-failing check.
 */
export const Idempotent = (): CustomDecorator<string> => SetMetadata(IDEMPOTENT_METADATA_KEY, true);
