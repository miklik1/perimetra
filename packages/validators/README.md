# @repo/validators

Zod schemas + inferred types: the single source of runtime contracts, consumed by `@repo/api`, `@repo/api-mocks`, and app forms, plus reusable field primitives (ADR 0022 Tier-B).

## Exports

Barrel (`@repo/validators`):

- User (`./user`): `userSchema` (`User`), `userListSchema`, `usersPageSchema` (`UsersPage`), `createUserSchema` (`CreateUserInput`).
- Auth (`./auth`): `loginSchema` (`LoginInput`), `loginResponseSchema` (`LoginResponse`).
- API error (`./api-error`): `apiErrorEnvelopeSchema` (`ApiErrorEnvelope`).
- Generic primitives (`./primitives`): `password`, `phoneE164`, `url`, `slug`, `positiveInt`, `money` — message-agnostic (translated copy comes from `@repo/i18n`'s zod error-map).

CZ-specific primitives stay behind the explicit `@repo/validators/primitives/cz` subpath: `ico`, `dic`, `psc`, `bankAccount`, `iban`, `rodneCislo` (the last is PII, scrubbed by telemetry). Delete one file to de-CZ a fork.

## Usage

Drive a form + its request contract from a shared schema (mirrors `apps/web/app/login/login-form.tsx`):

```tsx
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import { loginSchema, type LoginInput } from "@repo/validators";

const form = useForm<LoginInput>({
  resolver: zodResolver(loginSchema),
  defaultValues: { email: "", password: "" },
});
```

The same `loginSchema` is parsed at the `@repo/api` trust boundary, so client validation and the wire contract can't drift.

## Decisions

- [ADR 0009](../../docs/adr/0009-forms-rhf-zod-no-package.md) — forms use RHF + zod over these schemas; no `@repo/forms` package.
- [ADR 0007](../../docs/adr/0007-rest-data-layer.md) — schemas are the runtime contract `@repo/api` parses at the data seam.
- [ADR 0022](../../docs/adr/0022-typed-search-params-route-dx.md) — Tier-B field primitives, incl. the CZ set.
- [ADR 0020](../../docs/adr/0020-i18n-next-intl-use-intl.md) — primitives are message-agnostic; translation comes from `createZodErrorMap`.

## Adding a resource

`pnpm gen api-resource` — scaffolds the schema module and adds the export at the `@gen:exports` marker in `src/index.ts`.
