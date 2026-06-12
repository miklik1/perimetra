# @repo/ui

Web-only shadcn/Radix DOM components on the shared Tailwind v4 tokens; mobile UI lives in `apps/mobile` (split-UI — share logic, not pixels) (ADR 0006).

## Exports

Barrel (`@repo/ui`):

- `Button`, `buttonVariants` — button + its `cva` variants.
- `Toast`, `ToastViewport`, `toastVariants`, `ToastProps` — the custom toast presentation primitives (rendered by the app's `<Toaster>` over `@repo/store`'s queue).
- `cn` — `clsx` + `tailwind-merge` class combiner.

Subpaths: `@repo/ui/components/*` (per-component) and `@repo/ui/lib/*` (e.g. `@repo/ui/lib/utils`). `src/styles.css` carries the component styles (`sideEffects` allows the CSS).

## Usage

Render a button in a client component (mirrors `apps/web/app/login/login-form.tsx`):

```tsx
import { Button } from "@repo/ui";

<Button type="submit">{t("submit")}</Button>;
```

The Toast primitives are wired into the app's `<Toaster>` (`apps/web/app/toaster.tsx`), which subscribes to `@repo/store`'s toast queue and owns timers.

## Decisions

- [ADR 0006](../../docs/adr/0006-split-ui-web-dom-mobile-rn.md) — split UI: web DOM/RSC here, mobile RN in the app; share logic not pixels.
- [ADR 0001](../../docs/adr/0001-styling-split-ui-tailwind-v4.md) — web Tailwind v4 + shadcn DOM; no react-native-web.
- [ADR 0004](../../docs/adr/0004-theming-token-system.md) — components use the shared `@repo/tailwind-config/theme` semantic tokens (never raw palette).
- [ADR 0027](../../docs/adr/0027-toast-notification-store.md) — the custom Toaster presentation lives here, fed by `@repo/store`.
