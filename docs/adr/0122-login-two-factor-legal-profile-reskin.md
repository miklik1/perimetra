# ADR 0122 — Wave A: the /login + /two-factor + /team/legal-profile gap-fill reskin (kit form language, and the legal-profile IBAN gap-fill)

**Status:** Accepted (2026-07-23 — W8 Phase 2, Wave A, delivered through the reskin-wave method). Follows [ADR 0119](0119-orders-surface-reskin.md)/[ADR 0120](0120-quotes-surface-reskin.md)/[ADR 0121](0121-projects-customers-surface-reskin.md) (the wave method + the shipped kit form language) and applies the design authority ([ADR 0114](0114-design-canvas-adoption.md)) to the last raw, pre-kit forms. `design/README.md` §5 marks all three as gap-fill (no bespoke canvas board); §12 the ship bar.

## Context

None of the three surfaces has a design board — `design/README.md` §5 lists `/login` and `/team/legal-profile` as "IN (§5 gap-fill; no board exists)"; `/two-factor` is the same chromeless pre-session auth family and was bundled for a consistent look end-to-end. They were the last hand-rolled `<input>`/`inputClass`/border-box forms in the app. The design authority is therefore the shipped kit form language — `apps/web/app/customers/customer-form.tsx` (ADR 0121), whose own doc-comment names `LegalProfileForm` as its field-shape precedent — not a canvas.

`/login` and `/two-factor` are chromeless pre-session routes (AppShell `PUBLIC_PREFIXES`), each a SINGLE render branch (no AuthGuard). `/team/legal-profile` is an admin-only settings singleton inside `SettingsLayout`, with an AuthGuard fallback branch.

## Decision

**Reskin all three onto the kit form language, subtract every affordance the backend does not back, and close the one real functional gap (IBAN).**

- **/login** — `Panel` card + `Field > Field.Label > Field.Control > Input > Field.Error`; `bg-field` page background; the hardcoded English `"Sign in"` H1 → `<DisplayLabel as="h1">{t("login")}</DisplayLabel>`, and the static English `<title>` → an async `generateMetadata` on the `auth` namespace. **Preserved (load-bearing):** `method="post"` (ADR 1001 — a pre-hydration submit must not fall back to GET and serialise the password into the URL/Referer/logs), the `safeNextPath` open-redirect guard, and the `data.twoFactorRedirect → /two-factor?next=` branch. **Invented nothing** — no forgot-password, sign-up, SSO, or remember-me (contract-honesty §11.2: none has a backend; each would be a new Better-Auth flow, not a styling pass).
- **/two-factor** — same kit language; the title is a real semantic `<DisplayLabel as="h1">` on the page (the kit `Panel.Title` renders a plain `<div>`, so putting the title only there would leave the route with no heading — an a11y regression the review caught). TOTP verify mutation + success redirect preserved.
- **/team/legal-profile** — sectioned `Panel` blocks **Identifikace / Adresa / Bankovní spojení / Poznámka** on `Field`/`Input`/`Switch`/`Textarea`; `vatPayer` → kit `Switch`; `registrationNote` → `Textarea`; the inline ARES/VIES wiring folded into the shared `useAresLookup`/`useViesLookup` hooks (the same the customer form uses). The non-admin + loading notices are `Panel`-wrapped; the AuthGuard fallback keeps `min-h-screen` and gains `bg-field`. **No "Kontakt" section** (this entity has no email/phone — §11.2) and **no status Badge / archive action** (a singleton with no lifecycle endpoint — §11.2).

### The IBAN gap-fill (functional, not cosmetic)

`iban` was already wired end-to-end — `legalProfileSchema`/`upsertLegalProfileSchema` (`packages/validators`), the DB column, and the web query parse — but `LegalProfileForm`'s local schema never picked it up, so it could not be entered, and invoice-issue fails closed `422 iban_required` (ADR 0112) without it. Wave A adds `iban` to the form's local schema + `toDefaults` + the `toInput` submit payload + a kit `Input` in the new Bankovní-spojení section, and a new `legal-profile-form.test.tsx` pins the mapping (populate from `initial.iban`, trimmed value flows through `toInput`, cleared → null). The form-local schema stays lenient (`z.string()`, matching `ico`/`dic`/`bankAccount`); the server `upsertLegalProfileSchema` remains the sole strict mod-97 gate.

## Per-branch min-h-screen

- `/login`, `/two-factor`: single chromeless branch → **keep** `min-h-screen`, add `bg-field`.
- `/team/legal-profile`: authed content in `SettingsLayout` (no `min-h-screen`, correct — the shell owns scroll); AuthGuard fallback **keeps** `min-h-screen`, **gains** `bg-field` (it was missing, unlike every reskinned sibling fallback).

## Consequences

- i18n: reused `auth.login` + `auth.twoFactor.title`; added `legalProfile.sections.{identity,address,banking,note}`, `legalProfile.fields.iban`, and `auth.emailInvalid`/`auth.passwordRequired` (cs primary + en parity).
- No schema/endpoint change; no backend behaviour change → the integration suite was not required.
- Gate green: `pnpm turbo check-types lint test build --force` 81/81 (api 400, web tests incl. the new IBAN test, knip clean).
- Adversarial review (3 opus dims) found 3 issues, all confirmed and fixed before ship: the `/two-factor` heading regression, the un-localized page `<title>`s, and the missing IBAN test coverage.
- Eyes-on cleared ×6 ship-bar widths (390/768/1024/1194/1280/1440) in light + dark (`apps/web/scripts/verify/capture-wave-a.mjs`, new — an unauthenticated context for `/login`+`/two-factor`, an authed admin context for `/team/legal-profile`): the login card (localized H1, Panel, ink submit, both themes resolve — no half-flip), the two-factor card (semantic `<h1>`, matching family), and the legal-profile sectioned form (Identifikace/Adresa/Bankovní spojení/Poznámka, ARES + a live VIES badge, the Plátce-DPH `Switch`, and the side-rail→tab-bar responsive app shell). NO horizontal body scroll at any width. Console noise was limited to the known Centrifugo `:3000`-vs-`:3002` realtime 403 drift (fail-soft), a VIES teardown `AbortError`, and the carried AuthGuard-SSR hydration warning — none introduced by this wave.
