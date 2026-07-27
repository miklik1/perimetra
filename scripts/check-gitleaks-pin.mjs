#!/usr/bin/env node
// Repo-resident guard for the pinned `gitleaks` install step (ADR 1028).
//
// WHY THIS EXISTS. ADR 1028 replaced `curl | tar` with download → `sha256sum -c`
// → extract, so the CI secret-scan gate runs bytes we vetted rather than
// whatever the release URL happens to serve. That control was verified BY HAND
// in a scratch dir and written up as prose. Nothing in the repo failed if the
// control was weakened, and the two realistic weakenings are both quiet:
//
//   1. Someone bumps `GITLEAKS_VERSION` and forgets `GITLEAKS_SHA256`. CI then
//      dies with an opaque `sha256sum: FAILED` on a step nobody was editing —
//      and the cheapest way to make that message go away is to DELETE the
//      check. A gate whose failure mode invites its own removal needs a second
//      gate that names the real problem.
//   2. Someone "tidies" the step back to a pipe, or adds a `shell:` key without
//      `-e` (ADR 1028 precondition 2 — the guard aborts extraction only because
//      errexit is on). Both silently disarm the pin while CI stays green.
//
// WHAT THIS PROVES, AND WHAT IT DOES NOT.
//   IT PROVES: the workflow still has the download-verify-extract SHAPE, the
//   digest is a well-formed sha256, no `shell:` override can have dropped
//   errexit, and the (version, digest) pair in `ci.yml` still matches the pair
//   recorded in `scripts/gitleaks-pin.json` — the ledger a human updated when
//   they last actually downloaded and hashed the asset.
//
//   IT DOES NOT PROVE the digest is the true hash of the upstream artifact. No
//   static check can: that requires the bytes. The ledger is a TRIPWIRE, not an
//   oracle — its job is to make a half-bump (version moved, digest didn't, or
//   either moved without a recorded, deliberate re-hash) fail LOUDLY and with an
//   actionable message, instead of failing opaquely inside a CI step. Nor does
//   it prove upstream was honest at publication; ADR 1028 is explicit that the
//   pin is trust-on-first-use byte-freezing, not provenance.
//
// NO NETWORK in the default path, matching every other `check:*` in this repo
// (`check:control-chars`, `check:no-orphan-rn`) — this runs in the CI lint job
// and in lefthook pre-push, neither of which may depend on reaching github.com.
// Pass `--verify-download` to additionally fetch the asset and hash it for real;
// that is the mode a human runs WHEN BUMPING THE PIN, and it is what makes a new
// ledger entry honest.
//
// Usage:
//   node scripts/check-gitleaks-pin.mjs                  # static, offline (CI)
//   node scripts/check-gitleaks-pin.mjs --verify-download # live, when bumping
//
// `CI_WORKFLOW_FILE` overrides the workflow path so this guard's own mutation
// tests can point it at a mutated copy without touching the real file.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = process.env.CI_WORKFLOW_FILE
  ? resolve(process.env.CI_WORKFLOW_FILE)
  : join(repoRoot, ".github/workflows/ci.yml");
const ledgerPath = join(repoRoot, "scripts/gitleaks-pin.json");

const problems = [];
const fail = (msg) => problems.push(msg);

const workflow = readFileSync(workflowPath, "utf8");

// ---------------------------------------------------------------------------
// 1. The pinned values, read out of the workflow itself.
// ---------------------------------------------------------------------------
const versionMatch = workflow.match(/^\s*GITLEAKS_VERSION=([^\s#]+)/m);
const digestMatch = workflow.match(/^\s*GITLEAKS_SHA256=([^\s#]+)/m);

if (!versionMatch) fail("no `GITLEAKS_VERSION=` assignment found in the workflow (ADR 1028).");
if (!digestMatch) {
  fail(
    "no `GITLEAKS_SHA256=` assignment found in the workflow — the digest pin of ADR 1028 is GONE. " +
      "A version-only pin still executes whatever bytes the release URL serves.",
  );
}

const version = versionMatch?.[1];
const digest = digestMatch?.[1];

if (digest && !/^[0-9a-f]{64}$/.test(digest)) {
  fail(`GITLEAKS_SHA256 is not a lowercase 64-hex sha256: ${digest}`);
}

// ---------------------------------------------------------------------------
// 2. The SHAPE of the install step. ADR 1028's central point is that
//    `curl | tar` cannot be verified at all — the artifact never exists whole —
//    so the ordering download → verify → extract is the control, not the
//    presence of a constant.
// ---------------------------------------------------------------------------
// Matches across the shell line-continuation the original form used (`curl … \`
// newline `  | tar -xz …`), so a straight revert cannot slip past on layout.
if (/\|\s*(\\\s*\n\s*)?tar\s+-xz/.test(workflow) || /curl[\s\S]{0,200}?\|\s*tar\b/.test(workflow)) {
  fail(
    "the install step pipes curl into tar. That EXTRACTS AS IT STREAMS, so there is no complete " +
      "artifact to verify and the digest pin is unreachable (ADR 1028, 'Alternatives considered').",
  );
}

const verifyIdx = workflow.indexOf("sha256sum -c -");
if (verifyIdx === -1) {
  fail("the `sha256sum -c -` verification line is missing — the downloaded bytes are unchecked.");
}

const extractIdx = workflow.search(/^\s*tar -xz\b/m);
if (extractIdx === -1) {
  fail("no `tar -xz` extraction line found; the install step no longer has the ADR 1028 shape.");
} else if (verifyIdx !== -1 && verifyIdx > extractIdx) {
  fail(
    "`sha256sum -c -` runs AFTER `tar -xz`. Verifying post-extraction exits non-zero having ALREADY " +
      "written attacker-controlled bytes to disk — on the self-hosted runner of ADR 1007 that is the " +
      "whole attack.",
  );
}

// ADR 1028 precondition 2: the guard stops extraction only because a non-zero
// exit aborts the step. GitHub Actions runs `run:` blocks as `bash -e {0}`; a
// `shell:` key without `-e` silently disarms the pin (it was observed NOT to
// abort under zsh).
//
// SCOPED TO THE GITLEAKS JOB, deliberately. The first form of this rule matched
// `shell:` anywhere in the file and reported it with a message blaming the
// gitleaks step — so adding `shell: bash` to, say, the `lint` job reddened this
// guard with a diagnosis that was simply untrue of the change being made. A rule
// that fires on unrelated edits and then misattributes them is the cheapest
// possible invitation to delete the rule, which costs the real protection. The
// protection kept: any `shell:` inside the gitleaks job — a `defaults.run.shell`
// for the job, or a `shell:` on the install or scan step — still reddens, and
// those are the only places that can affect the pin.
// Sliced line-wise rather than by regex: a lazy `[\s\S]*?` with an `m`-flagged
// `$` alternative in the lookahead terminates at the first newline, which yields
// a one-line "job" that can never contain a `shell:` — a tripwire that silently
// never fires. Line slicing has no such trap and reads as what it is.
const sliceJob = (name) => {
  const lines = workflow.split("\n");
  const start = lines.findIndex((l) => l === `  ${name}:`);
  if (start === -1) return null;
  let end = start + 1;
  // The job body is everything indented deeper than the job key, blank lines
  // included; the next line at two-space indent (a sibling job, or a top-level
  // comment introducing one) ends it.
  while (end < lines.length && (lines[end].trim() === "" || /^ {3,}/.test(lines[end]))) end += 1;
  return lines.slice(start, end).join("\n");
};

const gitleaksJob = sliceJob("gitleaks");
if (!gitleaksJob) {
  fail(
    "no `gitleaks:` job found in the workflow at the expected two-space indent. Either the secret-scan " +
      "job was removed (this repo's ONLY automated secret-scan gate) or it was renamed — in which case " +
      "this guard is no longer inspecting it and must be updated.",
  );
} else if (/^\s*shell:/m.test(gitleaksJob)) {
  fail(
    "a `shell:` override appeared inside the `gitleaks:` job. ADR 1028 depends on Actions' default " +
      "`bash -e`: without errexit the digest mismatch is REPORTED but extraction proceeds anyway. " +
      "Re-verify the gitleaks step (add `set -euo pipefail` to its body) before allowing this.",
  );
}

// ---------------------------------------------------------------------------
// 3. The ledger cross-check — the actual tripwire for a half-bump.
// ---------------------------------------------------------------------------
let ledger;
try {
  ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
} catch (error) {
  fail(`could not read the pin ledger at scripts/gitleaks-pin.json: ${error.message}`);
}

// Only meaningful when a digest was actually found — otherwise the missing-pin
// error above already says everything, and a second "mismatch: undefined" line
// would just bury it.
if (ledger && version && digest) {
  const recorded = ledger.artifacts?.[version];
  if (!recorded) {
    fail(
      `ci.yml pins gitleaks ${version}, but scripts/gitleaks-pin.json has NO recorded digest for that ` +
        `version (it records: ${Object.keys(ledger.artifacts ?? {}).join(", ") || "nothing"}).\n` +
        `      This is the half-bump: the version moved and the vetted digest did not.\n` +
        `      Fix it by actually hashing the asset, never by copying the value from ci.yml:\n` +
        `        node scripts/check-gitleaks-pin.mjs --verify-download\n` +
        `      then add the printed digest to scripts/gitleaks-pin.json under "${version}".`,
    );
  } else if (recorded.sha256 !== digest) {
    fail(
      `DIGEST MISMATCH for gitleaks ${version}:\n` +
        `        ci.yml    : ${digest}\n` +
        `        ledger    : ${recorded.sha256}\n` +
        `      One of them was edited without re-downloading. Re-hash the real asset before choosing ` +
        `a winner (--verify-download).`,
    );
  }
}

// ---------------------------------------------------------------------------
// 4. Optional live verification. Off by default, on purpose (see header).
// ---------------------------------------------------------------------------
if (process.argv.includes("--verify-download") && version) {
  const url = `https://github.com/gitleaks/gitleaks/releases/download/v${version}/gitleaks_${version}_linux_x64.tar.gz`;
  console.log(`[gitleaks-pin] downloading ${url} …`);
  const response = await fetch(url);
  if (!response.ok) {
    fail(`--verify-download: HTTP ${response.status} fetching ${url}`);
  } else {
    const bytes = Buffer.from(await response.arrayBuffer());
    const actual = createHash("sha256").update(bytes).digest("hex");
    console.log(`[gitleaks-pin] ${bytes.length} bytes, sha256 ${actual}`);
    if (actual !== digest) {
      fail(
        `--verify-download: the UPSTREAM asset hashes to ${actual}, but ci.yml pins ${digest}. ` +
          `Either the pin is wrong or the release asset was replaced.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
if (problems.length > 0) {
  console.error("gitleaks pin check FAILED (ADR 1028):\n");
  for (const p of problems) console.error(`  ✗ ${p}\n`);
  console.error("  Reference: docs/adr/1028-gitleaks-pinned-by-sha256-digest.md");
  process.exit(1);
}

console.log(
  `gitleaks pin OK — v${version} pinned to ${digest?.slice(0, 12)}…, download→verify→extract shape intact (ADR 1028).`,
);
