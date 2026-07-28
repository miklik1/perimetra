# ADR 1047 — The SSRF hatch is a relaxation, never a bypass; and a guarded egress states its redirect posture

- **Status:** accepted
- **Date:** 2026-07-28
- **Amends:** [ADR 0034](0034-api-contract-and-seams.md) (the outbound-webhook
  seam whose `WebhookEndpointTarget` this narrows)
- **Relates to:** [ADR 0044](0044-security-baseline-supply-chain.md) (security
  baseline), [ADR 0043](0043-jobs-scheduling.md) (the relay's retry
  semantics), `web-native-skeleton` ADR 1041 (the mirrored lint fence)
- **Ports:** `anyora-platform` ADR 0079, which found this class in its own tree,
  named this repo and this file as carrying it live, and routed the fix to HQ
  rather than patching upstream from a derived repo.

## Context

Three separate questions were on this wave's slice, and the audit answered the
first one differently than expected — which is worth recording, because a
negative result that nobody writes down gets re-investigated.

**The redirect audit found nothing to fix.** The premise was that a newer
guarded call site had failed to inherit `redirect: "manual"` from the webhook
dispatcher. It had not: `WebhookDispatcher.deliver` is the ONLY call site of the
egress guard in this repo, and it already set `redirect: "manual"`, followed
hops by hand, re-ran the full pre-flight per hop, and capped the count. Every
other outbound `fetch` in the tree — PostHog purge, Centrifugo publish, the
presigned S3 upload, the web app's backend proxy — dials a FIXED
operator-configured host, is trusted first-party, and correctly routes through no
guard at all. (The proxy sets `redirect: "manual"` anyway, for its own reason:
not echoing an upstream `Location`.)

So the finding's rule was already satisfied, by one call site, by hand. That is
precisely the state the finding warns about: a fixed call site with no forcing
function is one refactor from regressing, and the next guarded egress this
skeleton grows — in a derived project, months from now, by someone who never read
this ADR — inherits nothing.

**What the audit DID find is the sibling class anyora had just closed.** The
hatch that lets a deployment reach receivers on its own private network was
placed at the TOP of both guard layers:

- Layer 1: `assertEgressUrlAllowed` short-circuited with
  `if (options.allowPrivateTargets) return url;` immediately after the scheme
  check, which put it ahead of the cloud-metadata hostname pre-block and ahead of
  all IP classification. On a permissive deployment,
  `http://169.254.169.254/…` and `http://metadata.google.internal/…` were
  therefore delivered to.
- Layer 2, the worse half: `WebhookDispatcher` computed
  `egressAgent = allowPrivateNetwork ? undefined : createSsrfGuardedDispatcher()`,
  so the guarded connector — the only layer that can see where a HOSTNAME
  resolves — was not relaxed but REMOVED. A receiver-supplied name that merely
  resolves to 169.254.169.254 sailed through untouched. That requires no DNS
  control at request time; a name registered pointing at the metadata address is
  enough. What sits at that address is the instance's IAM credentials.

The knob's stated purpose — reach a receiver on my own private network — does not
require reaching an instance-metadata service, and no deployment runs a webhook
receiver there. This was never a trade-off the knob made deliberately; it was
scope the implementation took because "private" and "not-public" had been treated
as the same set.

**And the flag was per-ENDPOINT, which is worse than deployment config.**
`WebhookEndpointTarget.allowPrivateNetwork` was threaded from endpoint
configuration into each delivery. Endpoint configuration is tenant-owned state
(ADR 0034) — a table is the shape a self-service registration door eventually
writes — so a per-endpoint variant is a tenant-writable switch that disables the
tenant's own SSRF guard. It hands the attacker the off button for the control
that exists to stop them. The field's doc comment said "never settable from
customer input", which is documentation, not a forcing function.

**Separately, the hop-following had a hazard the SSRF guard by design does not
address.** Each hop re-POSTs a body carrying an HMAC over the original payload.
Every hop the guard approves is, correctly, a legitimate public address — so a
receiver answering `302 Location: https://attacker.example/` made this server
deliver the signed document to a host IT named. anyora chose `redirect: "error"`
for this reason and recorded a convergence preference; see the divergence note
below for why this repo keeps hop-following instead.

## Decision

**1. The hatch relaxes the public-unicast ALLOWLIST and nothing else.** Four
checks now sit ahead of it and are unreachable by it, in both layers:

- the scheme gate (unchanged);
- the cloud-metadata HOSTNAME pre-block, now `metadata.google.internal`,
  `metadata.goog` and **the bare label `metadata`** — GCE resolves all three, the
  last via search-domain completion. The set moved out of
  `webhook-dispatcher.service.ts` into `ssrf-guard.ts` so both layers share one
  copy rather than two that can drift, and hostnames are normalised (brackets,
  trailing dot, case) before comparison;
- `UNCONDITIONAL_BLOCKS`: `169.254.0.0/16` and `fe80::/10` (IMDS answers at
  169.254.169.254 on AWS/Azure/GCP/DigitalOcean/OpenStack/Oracle; the whole
  link-local space is blocked rather than the single host, because no real
  receiver is reachable there so blocking wide costs nothing and there is no next
  IMDS address to chase), plus `fd00:ec2::/32` (AWS's IPv6 IMDS, INSIDE the
  unique-local space the hatch opens) and `100.100.100.200/32` (Alibaba, inside
  CGNAT for the same reason);
- the fail-closed unparseable-address rule. The hatch permits PRIVATE
  destinations, never unclassifiable ones.

`blockedReasonForIp(ip, options)` applies them in that order and consults the
hatch only afterwards, so there is one classification path shared by both layers.

**2. The guarded dispatcher is built unconditionally, configured permissively.**
`createSsrfGuardedDispatcher({ allowPrivateTargets })` is always constructed and
always attached to the fetch. Under the hatch the connector still resolves DNS,
still refuses the metadata hostnames before resolving them, and still refuses the
unconditional ranges; it merely stops refusing ordinary private/loopback/ULA
answers. Removing the dispatcher removes the only layer that sees a hostname's
resolution, which is precisely the hole.

**3. No per-endpoint and no per-delivery `allowPrivateNetwork` — the knob is
DEPLOYMENT-wide.** `WebhookEndpointTarget.allowPrivateNetwork` and
`DeliverOptions.allowPrivateNetwork` are both removed. The posture is a
constructor-injected `WebhookEgressPolicy`, provided once in `WebhooksModule`
from the new `WEBHOOK_EGRESS_ALLOW_PRIVATE` env var. The DI binding is
`@Optional()` so the seam still constructs bare — and the bare default is the
secure one.

**4. Redirect hops must be SAME-ORIGIN.** The full egress guard re-runs on the
hop first (so an SSRF-shaped `Location` is still reported as blocked, not as a
routing choice), and then a hop whose `origin` differs from the current target's
is refused with a message naming the fix: re-point the endpoint configuration.
`origin` covers scheme, host and port deliberately — an https→http downgrade and
a port change both reach something other than the endpoint that was configured.
This closes the signature-forwarding hazard, and it is also the treatment the
vault finding prescribes for a moved endpoint: loud, not silently followed.

**5. The property is made STRUCTURAL, not remembered:
`local/require-redirect-posture-on-guarded-fetch`.** A new ESLint rule requires
an explicit `redirect` posture on every `fetch` in a module that imports the
guard, and on every `fetch` that attaches a `dispatcher` (which catches an
out-of-tree guard too). It resolves an `init` built above the call, which is what
makes it bite on the real call-site shape rather than only on inline literals.
The rule refuses SILENCE, not either posture — refusing the hop and hand-following
it with a fresh pre-flight are both accepted, because which is right is a
per-call-site judgement. Its blind spots (unresolvable init, spread-carrying init,
cross-module wrapper) are documented in the rule and pinned as passing test cases,
so removing an under-flag means deleting an assertion rather than doing it by
accident.

## Disarm-verification

Every guard added here was broken on purpose and watched go red — a check that
cannot fail on the case it names is not a check.

| Disarmed                                                      | Went red                                                                                   |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| deleted `redirect: "manual"` from `deliver`                   | the lint rule (1 warning; `--max-warnings 0`) **and** 3 tests                              |
| restored `egressAgent = allowPrivate ? undefined : …`         | "the hatch does NOT drop the guarded dispatcher"                                           |
| moved the hatch back above `UNCONDITIONAL_BLOCKS` + hostnames | "the hatch still refuses cloud metadata, by address AND by name", "…the metadata ADDRESS…" |
| removed the cross-origin refusal                              | the wire HONEYPOT test (`honeypotHits` went from 0 to 1), plus 2 mocked-transport tests    |

The honeypot is the test the vault finding prescribes, on real sockets: a second
loopback server the receiver names in its `Location`, asserted to receive **zero**
requests. Under the hatch its address is perfectly reachable, so nothing but the
redirect posture stands between the signed body and it.

## Divergence from `anyora-platform`, recorded deliberately

Silent divergence between implementations is how the previous asymmetry went
unnoticed for a cycle, so both differences are stated:

- **Redirect handling.** anyora uses `redirect: "error"` — zero hop logic and
  therefore zero hop bugs — and recorded a convergence preference of anyora →
  skeleton. This repo keeps hand-following, because the skeleton's documented
  case is customer-supplied webhook URLs where a moved endpoint is a real
  scenario, and decision 4 removes the hazard that motivated anyora's choice
  (a cross-origin hop is now refused, so the signed body can only ever reach the
  origin the operator configured). If a project's receivers never redirect, the
  cheaper posture is still available and the lint rule accepts it.
- **Label for `fd00:ec2::254`.** Both trees now return `"cloud-metadata"` where
  the classifier previously returned `"uniqueLocal"`. The specific label is the
  point: the generic one is exactly what the hatch would have honoured.

## Consequences

- A permissive deployment (`WEBHOOK_EGRESS_ALLOW_PRIVATE=true`) can still deliver
  to `127.0.0.1`, `10.0.0.5`, `fc00::1` — the knob does its job — and can no
  longer reach any cloud instance-metadata endpoint by address OR by name, in
  either layer.
- `WebhookEndpointTarget` loses a field. A derived project that set it must move
  the intent to the env var; there is no per-tenant equivalent by design, and
  that is the point of the change rather than a migration cost of it.
- A cross-origin redirect that used to be followed now fails the delivery and
  retries through BullMQ into the DLQ, with a message naming the config to
  re-point. This is a behaviour change for any receiver that redirects across
  hosts, and it is intended to be noticed.
- `WebhooksModule` now imports `ConfigModule` explicitly. It is `@Global`, so
  this changes nothing at runtime; it makes the module self-contained so a
  testing module that imports `WebhooksModule` alone resolves the real policy
  instead of silently falling back to the bare-constructor default.
- The lint rule is repo-wide, so a project adding a guarded egress in `apps/web`
  or a package gets the same fence without wiring anything.

## Sources

- `apps/api/src/common/http/ssrf-guard.ts` (`BLOCKED_METADATA_HOSTNAMES`,
  `UNCONDITIONAL_BLOCKS`, `normalizeHostname`, `blockedReasonForIp`,
  `buildGuardedLookup`, `createSsrfGuardedDispatcher`)
- `apps/api/src/modules/webhooks/webhook-dispatcher.service.ts` (always-attached
  dispatcher, same-origin hops, `WebhookEgressPolicy`),
  `webhooks.module.ts` (deployment-wide wiring),
  `webhook-relay.handler.ts` (the removed per-endpoint field)
- `apps/api/src/common/config/env.ts` (`WEBHOOK_EGRESS_ALLOW_PRIVATE`)
- Fences: `apps/api/src/common/http/ssrf-guard.test.ts`,
  `apps/api/src/modules/webhooks/webhook-dispatcher.service.test.ts`,
  `webhook-dispatcher.ssrf.test.ts` (real transport + honeypot),
  `webhook-relay.handler.test.ts`
- The rule: `tooling/eslint/local/require-redirect-posture-on-guarded-fetch.js`,
  `tooling/eslint/local/__tests__/require-redirect-posture-on-guarded-fetch.test.js`,
  registered in `tooling/eslint/local/index.js` and `tooling/eslint/base.js`
- Vault finding: "A guarded egress that follows redirects re-opens the SSRF hole
  its pre-flight closed" (2026-07-24)
- Upstream ruling, read-only: `~/anyora-platform/docs/adr/0079-ssrf-hatch-is-an-allowlist-relaxation.md`
