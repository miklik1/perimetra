# ADR 0009 — Forms: React Hook Form + zod, schemas in `@repo/validators`, no `@repo/forms` package

**Status:** Accepted (2026-06-01).

## Context

The skeleton needs a forms pattern that works on both platforms and reuses the
single source of runtime contracts (`@repo/validators`, [ADR 0008](0008-shared-package-boundaries.md)).
The first real form is **create-user** (name + email → `POST /users` → invalidate
the users list).

[ADR 0008](0008-shared-package-boundaries.md) sets a default: each new concern
gets **its own package**, "not crammed into an existing package." Applied
literally, forms would get a `@repo/forms` package. But the genuinely-shared
surface is thin:

- The **input schema** (`createUserSchema`) is a runtime contract — it belongs
  in `@repo/validators`, which ADR 0008 already names as the home of "app-side
  form validation." Putting it in a forms package would split the contract layer.
- The **field UI** is platform-specific: web renders DOM `<input>` (shadcn),
  mobile renders RN `<TextInput>`. Nothing shared.
- The only platform-neutral glue is `useForm` + `zodResolver(schema)` — a
  two-line call. A package wrapping that would be the **shallow module** the
  architecture review explicitly warns against (interface ≈ implementation; the
  deletion test passes — delete it and nothing concentrates).

## Decision

- **No `@repo/forms` package.** Form input schemas live in `@repo/validators`;
  RHF + `@hookform/resolvers` `zodResolver` are wired **per app** at the
  interactive leaf, against the shared schema.
- **Library:** `react-hook-form@^7.77.0` + `@hookform/resolvers@^5.4.0`
  (default pnpm catalog — pure-JS, no native module, identical on web + RN).
- **The seam is the schema, not a package.** `createUserSchema` (in
  `@repo/validators`) is the one thing both platforms share; the resolver and
  the rendered fields are app-local.
- **Submit goes through the data layer:** a `create` mutation on the
  `@repo/api` users factory (`mutationOptions` → `apiFetch` `POST`), validated
  with `userSchema.parse` and followed by `invalidateQueries(keys.users.lists())`.
  Failures surface as `ApiError` ([ADR 0014](0014-error-handling-exceptions-at-the-data-seam.md)) —
  no `Result` idiom.

This is a deliberate deviation from ADR 0008's "own package" default, on the
grounds ADR 0008 itself implies (don't stub empty / don't create non-deep
packages): a forms package here would be shallow, so the right boundary is the
already-deep `@repo/validators`.

## Consequences

- One contract layer (`@repo/validators`) feeds both DTO parsing **and** form
  validation — no duplication, no split.
- Form components are written twice (web DOM, mobile RN), consistent with the
  split-UI thesis ([ADR 0006](0006-split-ui-web-dom-mobile-rn.md)); they share
  the schema and the mutation contract, not pixels.
- If a future need emerges for genuinely-shared form _logic_ (multi-step
  wizards, a cross-platform field-state machine), revisit with a package scoped
  to that logic and its own ADR — do not retro-fit a package around the thin
  resolver glue.

## Sources

- React Hook Form v7 + `@hookform/resolvers` zod resolver
  (https://react-hook-form.com, https://github.com/react-hook-form/resolvers).
- [ADR 0007](0007-rest-data-layer.md) (mutation through the `@repo/api` seam),
  [ADR 0008](0008-shared-package-boundaries.md), [ADR 0014](0014-error-handling-exceptions-at-the-data-seam.md).
