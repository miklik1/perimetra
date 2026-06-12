# ADR 0039 — API semantics: keyset pagination, idempotency, zod response serialization

**Status:** Accepted (2026-06-11). Implemented; live-probed (replay, cursor walk,
serialization-leak check).

## Context

Pagination style, mutation idempotency, and response shaping are decided
per-endpoint by whoever writes it first — ten projects yield ten conventions.
Worse, an unserialized Drizzle `select()` ships every column (ownerId,
deletedAt, one day passwordHash) straight to the client.

## Decision

- **Keyset pagination is the default** (offset only as documented exception):
  UUIDv7 PKs are creation-ordered, so the cursor IS the last item's id.
  Shared helpers in `@repo/validators/api`: `paginated(itemSchema)` envelope
  (`{ items, nextCursor }`) and `cursorQuerySchema`
  (`cursor`/`limit` 1–100/`sort`) that resource list queries `.extend()`.
  Repositories fetch `limit + 1` to compute `nextCursor`.
- **Validation:** nestjs-zod globally (`APP_PIPE`); DTOs come from
  `createZodDto` over the SHARED schemas in `@repo/validators` (the frontend
  forms validate with the same objects). Invalid input → **422** in the
  ApiError envelope: `{ message, code: "validation", errors: { "dotted.path":
[msgs] } }` — flows through the existing GlobalExceptionFilter unchanged.
- **Response serialization is mandatory:** `ZodSerializerInterceptor` globally
  - `@ZodSerializerDto(schema)` per route — responses are STRIPPED to the
    declared schema. Probe-proven: list items expose exactly the contract keys.
- **Idempotency:** opt-in `@Idempotent()` on unsafe routes. Key =
  `userId + method + path + Idempotency-Key`; Redis `SET NX EX 86400` claim;
  success stores `{status, body}` (with `XX` — expired claims never
  resurrect); replays return the stored response +
  `Idempotency-Replayed: true`; concurrent duplicates get 409
  `idempotency_in_flight`; handler failure releases the claim so retries
  re-execute. The KEY wins over the body (same key + different body replays
  the original — probe-proven), matching Stripe semantics.

## Consequences

- New resources copy the projects controller: DTOs + `@ZodSerializerDto` +
  `@Idempotent()` on create — three decorators buy the whole convention.
- The client half (envelope parsing, infinite-query cursors, Idempotency-Key
  injection) ships in the web example; `@repo/api` gains nothing bespoke.
- Known edge (documented in code): a failed-claim release racing a duplicate
  can yield one spurious 409; the retry is clean.
