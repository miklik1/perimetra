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
 */
export const Idempotent = (): CustomDecorator<string> => SetMetadata(IDEMPOTENT_METADATA_KEY, true);
