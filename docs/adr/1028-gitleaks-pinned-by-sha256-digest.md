# ADR 1028 — The gitleaks CLI is pinned by sha256 digest, not by version alone

**Status:** Accepted (2026-07-20) — **HQ-ruled default, Martin ratify queued**. Hardens the install step introduced by the CI-posture work of [ADR 1007](1007-ci-self-hosted-runner-default.md); the scan gate itself is [ADR 0031](0031-nestjs-modular-monolith-worker-split.md)/[ADR 0044](0044-security-baseline-supply-chain.md). Originates downstream in **mercata ADR 0117** (commit `e9a9e38`), where the same hardening was taken as a deliberate divergence from a straight skeleton drain; the reasoning below is written for this repo rather than copied.

## Context

This repo's `gitleaks` job is the only automated secret-scan gate in CI. Before this change, `.github/workflows/ci.yml` installed the scanner like this:

```yaml
- name: Install gitleaks
  run: |
    GITLEAKS_VERSION=8.24.3
    curl -sSfL "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz" \
      | tar -xz -C "$RUNNER_TEMP" gitleaks
```

That was `ci.yml:287-291` immediately before this edit. The version is pinned; the **bytes are not**. A GitHub release asset is mutable in practice — a compromised maintainer account, a registry incident, or a re-uploaded tag substitutes different content behind the same URL and the same version string. Whatever the URL serves is what executes.

The piped form is worse than an unverified download in one specific respect, and this is the reason the fix is a restructure rather than an added line: `curl | tar` extracts bytes **as they stream**, so there is no moment at which the complete artifact exists to be checked. Verification is not merely absent, it is unreachable without changing the shape of the step.

The rest of the CI-runner posture had already landed here — `permissions: contents: read` (`ci.yml:33-34`), the fork-PR fence (`ci.yml:279`), and the move from `gitleaks-action@v3` to the pinned CLI, whose comment at `ci.yml:271` explicitly notes it "matches web-native-skeleton's job". The digest pin was the one deliberate divergence in the sibling repo that was never drained back here.

Blast radius is governed by `ci.yml:280`, `runs-on: ${{ vars.CI_RUNNER || 'ubuntu-latest' }}`. On a hosted runner a swapped binary executes on a throwaway VM with a read-only token — bad, bounded. The day `CI_RUNNER` points at a persistent self-hosted runner (the stated direction of ADR 1007), the same swapped binary executes on Martin's own hardware with persistent access. The control is being installed **before** the exposure it exists for, which is the correct order.

## Decision

Download to a file, verify the digest, and only then extract:

```bash
GITLEAKS_VERSION=8.24.3
GITLEAKS_SHA256=9991e0b2903da4c8f6122b5c3186448b927a5da4deef1fe45271c3793f4ee29c
curl -sSfL -o "$RUNNER_TEMP/gitleaks.tar.gz" \
  "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz"
echo "${GITLEAKS_SHA256}  $RUNNER_TEMP/gitleaks.tar.gz" | sha256sum -c -
tar -xz -C "$RUNNER_TEMP" -f "$RUNNER_TEMP/gitleaks.tar.gz" gitleaks
```

The inline comment carries the maintenance contract — **"Bump both values together"** — because the failure mode of a half-bump is a hard CI failure with an opaque `sha256sum: FAILED` message. That sentence is load-bearing, not decoration.

### The verified preconditions this fix rests on

Two preconditions were checked rather than assumed, because the fix is unsound without them.

**1. The digest corresponds to the version _this_ repo pins.** Both repos pin 8.24.3, so mercata's constant applies unchanged — but it was not copied on trust. The release asset was re-downloaded and hashed independently: `sha256sum` of `gitleaks_8.24.3_linux_x64.tar.gz` (5 796 002 bytes) is `9991e0b2903da4c8f6122b5c3186448b927a5da4deef1fe45271c3793f4ee29c`, byte-identical to the reference constant. Had the versions differed, the correct digest for this repo's version would have been obtained and stated; inventing one was never an option.

**2. The step runs under a shell with `errexit`.** The guard is `sha256sum -c -` followed by `tar` as a separate command — it stops the extraction only because a non-zero exit aborts the step. This was initially tested in a subshell under `zsh`, where the mismatch was **detected and reported but did not abort**, and `tar` ran anyway. That near-miss is recorded here deliberately: the guard's soundness depends on the shell, not only on the script. GitHub Actions runs `run:` blocks as `bash -e {0}`, and `ci.yml` contains **no `shell:` override** on any job, so errexit applies. Re-tested under `bash -e`, the step exits 1 and leaves no binary on disk. Anyone adding a `shell:` key to this job without `-e` silently disarms this ADR.

## Alternatives considered and rejected

- **Add `sha256sum` while keeping `curl | tar`.** Rejected as impossible, not merely inferior. The pipe extracts as it streams; there is no complete artifact to verify and no point before execution at which the check could bind. This is why the step was restructured rather than extended.
- **Verify after extracting.** Rejected: it exits non-zero while having _already written_ attacker-controlled bytes to `$RUNNER_TEMP`. On an ephemeral hosted runner that is nearly harmless; on the persistent self-hosted runner this ADR is aimed at, it is the whole attack. The test below asserts on the **absence of the extracted binary**, not merely on the exit code, precisely to pin this ordering.
- **Add `set -euo pipefail` to the step body** as belt-and-braces for precondition 2. Rejected for now: Actions guarantees `bash -e`, no `shell:` override exists, and keeping this step byte-identical to mercata's keeps future drains between the two repos a clean no-op diff. The dependency is documented above instead. If a `shell:` override is ever added to this workflow, revisit this.
- **Pin the lefthook pre-commit hook's `gitleaks` too.** Rejected as out of scope and probably wrong: `lefthook.yml` deliberately degrades gracefully when the binary is absent, on the stated grounds that "CI scans every PR regardless". The local hook is a convenience, not the gate.
- **Sigstore / release attestation verification.** Rejected as disproportionate today: it adds a verification toolchain to every CI run to improve on a constant that changes roughly once a year.

## Consequences

- **The property bought is byte-freezing, not provenance.** This digest is trust-on-first-use. It records the bytes the release URL served on 2026-07-20 — which is exactly what the unpinned job would have executed that same day. It does **not** retroactively establish that 8.24.3 was honest at publication; nothing here verifies gitleaks' signing or attestation. What it buys is that any _future_ substitution is caught. This limit is stated in the workflow comment as well, because a control trusted beyond its strength is a liability.
- **Version bumps now fail closed.** A bump of `GITLEAKS_VERSION` without `GITLEAKS_SHA256` breaks CI with `sha256sum: FAILED`. That is the correct direction to fail, but it is opaque; if Renovate is ever configured to touch this workflow it will produce hard-failing PRs, and that should be a known behaviour rather than a surprise.
- **`sha256sum` availability** is guaranteed on `ubuntu-latest` (coreutils) but is unverified for a future self-hosted `CI_RUNNER` image — the very scenario this pin exists for. Noted, not engineered around; the runner image is HQ-owned (ADR 1007).
- **The stale durable record is now corrected (2026-07-20, serialized repair).** `SECURITY.md:131` described this gate as "`gitleaks` job (gitleaks-action v3)" scanning the "incoming commit range", with full history only on `workflow_dispatch`. Both halves were re-verified against `ci.yml` and were false: no `gitleaks-action` reference remains anywhere in the workflow, and the job checks out at `fetch-depth: 0` then runs `detect --source .`, so **every** event scans full history. The row now says so and cites this ADR for the digest pin. The same false claim was also sitting in `ci.yml`'s own `workflow_dispatch` comment ("on dispatch the gitleaks-action scans every commit … instead of an event range") and was corrected in lockstep. `docs/adr/0044` still describes the gitleaks-action arrangement; its BODY is left alone deliberately — it records the decision as taken at the time, and ADRs are superseded, not edited. **Amended 2026-07-20 ([ADR 1029](1029-the-guards-were-guarding-nothing.md)):** "not edited" was taken too literally here — 0044 was left with no forward pointer at all, which is not superseding, it is abandoning. Superseding means the old record SAYS it is old. 0044 now carries a "Partially superseded — the secret-scan gate only" note in its status block pointing here; its body is still untouched. Note also that the correction described in this paragraph was never repo-wide: it covered `SECURITY.md:131` and the `ci.yml` comment, and explicitly not 0044 — so the sweep should be read as "every instance in the as-built documents", not "every instance anywhere".
- **The pin now has a repo-resident guard: `pnpm check:gitleaks-pin`** (`scripts/check-gitleaks-pin.mjs`, wired into the CI lint job and lefthook pre-push). Written because the failure mode described above — an opaque `sha256sum: FAILED` inside a job nobody was editing — _invites its own removal_: the cheapest way to make that message stop is to delete the verification. **What it proves:** the download→verify→extract ordering is intact, `curl | tar` has not returned, the digest is well-formed, no `shell:` key has appeared that could drop the errexit this ADR depends on, and the `(version, digest)` pair in `ci.yml` still matches the pair recorded in `scripts/gitleaks-pin.json` — the ledger a human wrote after actually hashing the asset. **What it does not prove:** that the digest is the true hash of the upstream artifact. No offline check can; that needs the bytes. The ledger is a tripwire that makes a half-bump fail _loudly and by name_ rather than opaquely, and the duplication between the two files is the mechanism, not an accident. `--verify-download` performs the real fetch-and-hash and is the mode to run when bumping the pin; it is deliberately not on the CI path, since no other `check:*` in this repo requires network access.

## Verification

Executed, not inspected — a workflow edit has no unit-test seam, so the test is a reproduction of the step body.

1. **Positive** — step body verbatim under `bash -e` with `RUNNER_TEMP` set to a scratch dir: prints `gitleaks.tar.gz: OK`, extracts, and `gitleaks version` reports `8.24.3`. Confirms the `-f` restructure (absent in the original piped form, and the easiest thing to fumble) is well-formed.
2. **Negative / the actual guard** — one character of `GITLEAKS_SHA256` mutated: prints `FAILED`, step exits 1, and **no `gitleaks` binary exists** in `$RUNNER_TEMP`.
3. **Disarm control** — the same mutated-digest run with the `sha256sum` line deleted extracts successfully and exits 0. This is what makes test 2 meaningful: it proves the guard, and not some incidental property of the tarball, is what stops the extraction.
4. **Tampered artifact** — a byte overwritten in the downloaded tarball, then verify+extract only: fails closed, no binary. Proves the check binds to the bytes on disk rather than to a value echoed from the same variable.
5. **End-to-end** — the pinned binary run exactly as `ci.yml` does: `gitleaks detect --source . --no-banner --redact` from the repo root scans 150 commits, finds no leaks, exits 0. Confirms `.gitleaks.toml` is still auto-detected after the install-step restructure.
6. **The repo-resident guard reddens on each disarm.** `scripts/check-gitleaks-pin.mjs` was mutation-tested against copies of `ci.yml` (via its `CI_WORKFLOW_FILE` override, so the real file was never touched): version bumped without the digest → exit 1 naming the half-bump; `GITLEAKS_SHA256` line deleted → exit 1; `sha256sum -c -` line deleted → exit 1; a `shell:` override added → exit 1; reverted to `curl | tar` → exit 1 on three counts. Unmutated → exit 0. Additionally the ledger digest was mutated in place and the repo-level lefthook `pre-push` run went red, then green again on restore.
7. **The digest was independently re-derived for this ADR's own check**, not copied from the workflow: the 8.24.3 asset was downloaded again on 2026-07-20 and hashed — 5 796 002 bytes, `9991e0b2…4ee29c`, matching. That is the value recorded in `scripts/gitleaks-pin.json`.
8. **YAML validity** — `ci.yml` parses; the `Install gitleaks` step's `run` scalar contains the digest and the `sha256sum -c -` guard and no longer contains `| tar`.
