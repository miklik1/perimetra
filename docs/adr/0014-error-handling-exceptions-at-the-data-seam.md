# ADR 0014 — Error handling: exceptions at the data-layer seam; no `Result` idiom

**Status:** Accepted (2026-06-01).

## Context

The skeleton shipped two contradictory ways to model failure:

- **Exceptions at the IO seam.** `apiFetch` throws `ApiError` for every failure
  mode (`network` / `http` / `parse`), and zod's `.parse()` throws on invalid
  input ([ADR 0007](0007-rest-data-layer.md),
  [ADR 0012](0012-api-client-factory.md)). This is what the data layer actually
  does, end to end.
- **A `Result<T, E>` discriminated union** (`ok` / `err` / `isOk` / `isErr`) in
  `@repo/utils`, exported from the barrel — and imported **nowhere** outside its
  own test.

A reference skeleton teaches by example; shipping two answers to "how do we
model failure?" with no guidance teaches ambiguity. The `Result` type passed the
deletion test cleanly: removing it concentrated nothing, because nothing
depended on it.

The chosen stack is exception/error-state shaped throughout:

- **TanStack Query** expects a `queryFn`/`mutationFn` to **throw** on failure; it
  surfaces that via `error` / `isError`. A `Result` return value would defeat
  Query's own error machinery (a resolved `err(...)` reads as success).
- **zod** validates by throwing (`.parse`) or via its own typed result
  (`.safeParse`) — not via `@repo/utils`'s `Result`.
- **React Hook Form + zod** (the Stage 3d forms, [ADR 0009] reserved) surface
  validation through RHF's `formState.errors`, and submit failures through a
  `useMutation` that throws.

So `Result` had no home in this stack, and Stage 3d would not give it one. This
is the key difference from the `assert` / `format` helpers in `@repo/utils`,
which are pure leaf utilities that **compete with nothing** and are kept as
intentional batteries — `Result` competes directly with the stack's exception
model.

## Decision

- **Failure is modelled with exceptions at the data/IO seam.** `apiFetch` throws
  `ApiError` (a discriminated `kind`: `network` | `http` | `parse`); callers
  consume it through TanStack Query's `error` state or an error boundary.
- **Validation throws** (zod `.parse` in the data layer; RHF + `zodResolver`
  surfaces field errors in forms).
- **Remove the `Result` idiom.** Deleted `@repo/utils`'s `result.ts` +
  `result.test.ts` and the barrel re-export. If a future need arises for typed
  failures in a pure-domain module where exceptions are genuinely awkward,
  reintroduce `Result` **scoped to that module** with its own ADR — do not
  re-add it as a global `@repo/utils` export competing with the seam exceptions.

## Consequences

- One error idiom to learn; failures are shaped in one place (the `ApiError`
  seam) and observed in one way (TanStack `error` / error boundaries / RHF).
- `ApiError.kind` stays the single discriminator for IO failures; UI branches on
  it rather than on an ad-hoc `Result.error`.
- `@repo/utils` shrinks to genuinely-used, non-competing helpers (`assert`,
  `logger`, `format`).
- No runtime change — `Result` had no callers; this is a teaching/coherence
  decision, enforced by deletion.

## Sources

- `packages/api/src/client/create-api-client.ts` — `ApiError` + the three
  `throw new ApiError({ kind })` sites.
- TanStack Query v5 error model: a throwing `queryFn`/`mutationFn` drives
  `error` / `isError` (https://tanstack.com/query/latest).
- [ADR 0007](0007-rest-data-layer.md), [ADR 0012](0012-api-client-factory.md),
  [ADR 0008](0008-shared-package-boundaries.md).
