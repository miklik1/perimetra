# ADR 1005 — Lint rule: `<form>` with a secret/PII-bearing named input must carry `method="post"`

**Status:** Accepted (2026-07-12) — **HQ-ruled default, Martin ratify queued** (do-first doctrine 2026-07-12, ruling #2). Extends [ADR 1001](1001-login-form-post-method.md).

## Context

ADR 1001 fixed the login form: a `<form>` defaults to `method="get"`, so a submit landing **before** React hydrates falls back to the native GET and serialises every _named_ control into the URL — and from there into browser history, the Referer header, and the access logs of every hop. `onSubmit` does not protect that pre-hydration window; only `method="post"` does. ADR 1001 fixed one form and its Consequences proposed a lint rule as the durable, structural cure.

Two facts make a rule necessary rather than optional. First, the leak is armed by react-hook-form: `register("x")` spreads `name="x"` onto the rendered input, so any registered field is GET-serialisable — the class is not limited to passwords. The skeleton's own sweep found `create-user-form.tsx` registering `email` on a method-less form — the same leak, unfixed. Second, ADR 1001's own proposed rule was scoped to `type="password"` only; that is narrower than the real class (email, phone, national id, etc. are all PII that must not ride a GET).

**Perimetra adaptation:** perimetra already closed the instance ahead of the rule — [`d3a4c2c`](https://github.com/miklik1/perimetra/commit/d3a4c2c) applied ADR 1001's class rule fleet-wide, so every form (including `create-user-form.tsx`) already carries `method="post"`. The rule therefore lands here as a **pure structural guard** — nothing to fix on import, and the lint gate stays green — protecting against a future PII form regressing.

## Decision

Add a local ESLint rule `local/no-form-missing-method-with-sensitive-input`, wired into `tooling/eslint/next.js` and `react-internal.js` at `"warn"` (the house convention; `--max-warnings 0` in the lint script makes it CI-blocking). It flags a `<form>` whose `method` is absent or a literal other than `"post"` (case-insensitive) when the form contains a descendant carrying either a literal `type="password"` or a sensitive field name — taken from a literal `name="…"` attribute or a `{...register("…")}` spread with a string-literal argument. Sensitivity is an always-checked STRONG substring set (`email`, `password`, `ssn`, `creditCard`, `iban`, `passport`, `taxId`, `nationalId`, …) plus an exact-match list (`piiFieldNames`, overridable per project). The broadening beyond ADR 1001's `type="password"` text is deliberate and stated here so the rule is read as a considered extension, not a literal implementation of ADR 1001.

In the skeleton, `create-user-form.tsx` gains `method="post"` in the same change (ADR 1001's own precedent: bundle the instance fix with the regression guard), so the rule lands on a clean tree. In perimetra that instance was already fixed (see the adaptation note above), so the tree is already clean.

## Consequences

- The GET-leak class is now caught at lint time on every form across the fleet (the rule ships in both skeletons; every derived repo inherits it). A new PII form without `method="post"` fails the gate.
- Documented conservative blind spots (matching the house style of the other local RHF rules): a dynamic `method={expr}` is treated as satisfied (unprovable); a dynamic `register(varName)` argument is ignored; a `<Controller>`-wrapped input exposes its name at runtime, not as a static `register("x")` call, so it is not seen; the bare token `name` is excluded from the default list (a person's name vs a project's name is ambiguous at the identifier level). These are under-flags, never false blocks.
- **HQ-ruled default (ratify queued):** building the rule (and the broadening) is HQ's call under the do-first doctrine; Martin's ratification/veto is queued in the Brain hub.
- web-native-skeleton has no local-rule infrastructure yet, so the rule ships there by bootstrapping the `tooling/eslint/local/` plugin scaffold + its test-runner plumbing (a separate change; the rule logic is identical).

## Sources

- [ADR 1001](1001-login-form-post-method.md) — the origin decision and its proposed follow-up.
- Vault decision: "do-first doctrine & blocker triage (2026-07-12)", ruling #2.
- Engineering finding: "a form's missing method leaks only the inputs that carry a name — so RHF register() arms it".
- Rule + tests: `tooling/eslint/local/no-form-missing-method-with-sensitive-input.js` (+ `__tests__/`).
