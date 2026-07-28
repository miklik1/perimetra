# ADR 0141 — W17 channel-A drain `e240395..543a574`: the SSRF hatch, the audit record, and the sorter that was silently off

**Status:** Accepted (2026-07-28). Implemented.

Drains fullstack-skeleton `e240395..543a574` — skeleton ADRs
[1047](1047-the-ssrf-hatch-is-a-relaxation-not-a-bypass.md),
[1048](1048-the-two-argued-audit-residues.md) and
[1049](1049-theme-aware-tailwind-class-sorting.md) — into perimetra, and bumps
`package.json#skeleton.baseCommit` to `543a574` in the same commit. Each drained
ADR keeps its upstream number and its body verbatim per the reserved-band rule;
`docs/adr/README.md` carries one provenance row per ADR. This ADR records what is
true of the drain as a whole.

## What was taken, and what state it found here

**ADR 1047 — the SSRF hatch. Every defect was live here, and the take was
wholesale.** Nine files were byte-identical to upstream's pre-fix version
(`ssrf-guard.ts` + its test, all six `modules/webhooks/*` files, and
`tooling/eslint/local/index.js`), so there was nothing to merge — the fixed
versions replace them outright. Two files diverged and took the hunk instead:
`tooling/eslint/base.js` (the rule registration) and
`apps/api/src/common/config/env.ts` (the new `WEBHOOK_EGRESS_ALLOW_PRIVATE`).

The substance is upstream's: the hatch now relaxes the public-unicast allowlist
and nothing else, with the scheme gate, the cloud-metadata hostname pre-block,
the `UNCONDITIONAL_BLOCKS` list and the fail-closed unparseable-address rule all
sitting ahead of it in both layers; the guarded dispatcher is built
unconditionally and configured permissively rather than removed; the per-endpoint
and per-delivery flags are deleted in favour of a deployment-wide env knob; and
redirect hops must be same-origin.

**Severity note specific to this tree:** perimetra's `WebhooksModule` is still
unwired by design — nothing imports it and no endpoint registry exists — so the
IMDS-reachable path had no production caller. This is hygiene landing before a
consumer, not an incident being cleaned up. It does not lower the value of the
fix, because the ADR's own argument is that a per-endpoint flag is exactly what a
future self-service registration door would write.

**The lint fence was adopted, not just the code.** `local/require-redirect-posture-on-guarded-fetch`
is registered at `"warn"` (blocking under `--max-warnings 0`). This is the fleet
obligation perimetra was explicitly still open on, and it is taken as a fence
rather than as a one-off audit of call sites: the audit's answer goes stale the
moment someone adds a guarded egress, while the rule refuses the silence
structurally. **Measured after the drain: zero warnings repo-wide** — every
guarded fetch here already states its posture, so the fence lands green and its
value is entirely prospective.

**ADR 1048 — the audit record.** `.audit-allowlist.json` is taken. It is a
**review record, not an enforcement artifact**: nothing in this repo reads it, and
perimetra's actual gate is the `pnpm audit --prod --audit-level=high` step in CI,
which fails on any high advisory and consults no allowlist. It is worth carrying
anyway, because it is where the argument for each accepted residue survives.
Measured in this tree on 2026-07-28: 9 vulnerabilities (2 low, 5 moderate,
2 high), and the two high advisories are exactly the two upstream documents —
`GHSA-mh99-v99m-4gvg` (brace-expansion, no fix on the v1 line, reachable only
through the expo/jest coverage chain) and `GHSA-45rx-2jwx-cxfr`
(propagator-jaeger, never constructed because `OTEL_PROPAGATORS` is unset here).

**The propagator-jaeger override in 1048 was shipped wrong upstream and reverted
in `543a574` itself; perimetra never took it, so it is a no-op here.** Recorded so
nobody re-derives it as a missing upgrade: forcing `propagator-jaeger@2.10.0`
installs a SECOND `@opentelemetry/core`, because 2.10.0 pins core exactly rather
than with a caret. Perimetra ADR [1040](1040-the-blind-tree-nineteen-advisories-and-no-gate.md)
had already declined that override for precisely this reason, so W15's original
refusal was right and is now confirmed upstream.

**ADR 1049 — the sorter that was silently off.** This is the item W16
deliberately deferred as formatting-not-security. It arrives with an ADR and it
is not comment-only: it is a real functional fix, and every upstream
precondition was present and unfixed here.

The mechanism matters because it is unintuitive. `prettier-plugin-tailwindcss`
resolves a relative `tailwindStylesheet` against the directory of the file being
formatted, not against the Prettier config as its README claims — so
`apps/web/prettier.config.js`'s `"./app/globals.css"` resolved to
`apps/web/app/app/globals.css` for every file under `app/` and matched nothing. It
was a committed silent no-op, and it is deleted rather than repaired, because one
absolute path derived from the shared config's own location serves the whole repo.

**The fourth requirement nobody originally scoped: `tailwindcss` must be declared
at the repo ROOT.** The plugin derives its module base from the resolved prettier
_config file's_ directory — which is the root `package.json`'s `"prettier"` key —
and under pnpm's isolated `node_modules` the root had no `tailwindcss`, so the v4
`__unstable__loadDesignSystem` threw and was swallowed in a bare `catch`. The
failure mode is silence: every `@theme` token sorts as an unknown class and is
hoisted to the front of the list. `knip.json` gains a matching
`ignoreDependencies` entry, since nothing imports it from source.

**The re-sort is 123 files here against upstream's 15** — expected, because
perimetra has `packages/ui`, `/brand-lab` and far more product surface than the
skeleton. `apps/web` and `apps/mobile` gain `@repo/tailwind-config` as a real
dependency (the `@import "@repo/tailwind-config/theme"` in each CSS entry
previously resolved only from `packages/ui`), and `apps/web` drops
`@repo/prettier-config` along with its deleted config file.

## Two upstream debts, reported rather than fixed here

**The ADR-1039 doc drift is confined to one upstream line and needs nothing in
this tree.** Skeleton `docs/adr/README.md` names the new required field `attach`;
what shipped is `origin` / `SubscribedOrigin`, the ADR _body_ says `origin`, and
`attach` appears nowhere in `packages/realtime/src`. Perimetra's own row is
already correct and already boards it as owed upstream (ADR
[0138](0138-w16-channel-a-drain.md)). Re-reported to the skeleton seat; still a
one-line fix in their tree.

**`STRUCTURAL_KEYS` is still open, and perimetra's drained copy IS exposed** —
byte-identical to skeleton HEAD. `packages/telemetry/src/scrub.ts` matches
`/^(module|function|event_id|release|dist|environment|server_name|platform)$/`
as a bare key name at **any depth**, and the matching branch is a raw
pass-through (`record[key] = entry`) rather than a weakened redaction, so
`redactString` never runs at all. Contrast the branch immediately above it, which
skeleton ADR [1044](1044-filename-is-not-a-reserved-word.md) repaired to be
frame-anchored (`at.frame && SOURCE_LOCATION_KEYS.test(key)`).

The blast radius here is wider than "a stack-trace exemption" suggests: the same
walk runs over `extra`, every `contexts.*` bag and every breadcrumb `data` bag via
`beforeSend`/`beforeBreadcrumb`, **and** over every PostHog property bag through
`scrubProperties` — where the analytics pre-pass offers no value-shape defence of
its own, making `redactString` the only thing between a property value and an
email, rodné číslo, JWT or Bearer token. `release` is also perimetra's single most
load-bearing domain noun, and the release editor's raw-JSON islands put
vendor-authored key names into browser state.

No perimetra call site writes those names into a telemetry bag today, so this is
latent rather than leaking — which was equally true of `filename` right up until
ADR 0129 made an e-mailed attachment filename a live shape. **It is deliberately
NOT forked here.** `scrub.ts` has been drained three times in three waves
(skeleton ADRs 1031 → 1043 → 1044); a perimetra-local divergence in the exact
function the drain keeps touching would cost more than it saves, and the skeleton
seat has it in their order for this wave.

## Deliberately left

CI (still red since 2026-06-19 and still parked until release), all loading UI
and the `(home)` route group, and the webhooks module docs
(`modules/webhooks/README.md` and `CONTEXT.md` still describe the
`allowPrivateNetwork` opt-out this change deletes — upstream left them untouched
too, so the repair is owed in BOTH trees and is boarded rather than smuggled into
a drain commit).
