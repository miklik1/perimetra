#!/usr/bin/env node
/**
 * Design-sync preflight (ADR 0114 §7.5): `pnpm design-sync:preflight`.
 *
 * The problem (ADR 0114 §1): `.design-sync/config.json` does NOT read the
 * canonical token file. It sets `"tokensGlob": ".ds-css/theme.css"`, which
 * resolves to `packages/ui/.ds-css/theme.css` — historically a HAND-MAINTAINED
 * copy of `tooling/tailwind-config/theme.css`, kept in sync by an instruction in
 * `.design-sync/NOTES.md` and by nothing else. Edit the canonical file, forget
 * the copy, and the sync ledger's `styleSha` is computed from the STALE copy and
 * reports "no change" — the inverse of a drift detector, because the drift
 * becomes invisible rather than merely undetected.
 *
 * Why not a test: `packages/ui/.ds-css/` and `.design-sync/` are both excluded
 * from git (`.git/info/exclude`, deliberately — a sibling agent session works
 * this repo live). An md5-equality test would either fail universally or skip
 * silently in a fresh clone, and a silently-skipping guard enforces nothing.
 *
 * The fix: GENERATE the copy instead of checking it. This one command copies the
 * canonical `theme.css` into `packages/ui/.ds-css/` and runs the Tailwind
 * compile, so `tokensGlob` and `cssEntry` are both derived from source in the
 * same action. The copy cannot go stale because nothing authors it. Run this
 * BEFORE every design-sync converter build.
 *
 * The entry-import guard runs HERE, inside the preflight, on a machine where the
 * untracked `.design-sync/` is present — the only place the assertion is real.
 * When that directory is absent the guard cannot run, so the preflight exits
 * NON-ZERO (code 2) after saying why. A loud message is not loudness to a caller:
 * CI jobs, lefthook gates, `&&` chains and agents key on the exit code, and a
 * partial run that exits 0 is exactly the "skip silently and enforce nothing"
 * guard ADR 0114 §7.5 forbids. Pass `--allow-missing-design-sync` to opt INTO a
 * zero exit for callers that genuinely only want the tracked-file half.
 *
 * The two published artifacts are COUPLED: `tokensGlob` (.ds-css/theme.css) and
 * `cssEntry` (.ds-css/compiled-tailwind.css) exist to be derived from source in
 * the same action, and the converter cannot detect a mismatch between them. So
 * both are staged and published only after the compile succeeds; on any failure
 * or skip path the stale compiled copy is REMOVED rather than left to pair with
 * a freshly-regenerated theme.css.
 *
 * Stdlib only; idempotent.
 */
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The canonical token file, repo-relative with POSIX separators. This single
 * constant is the ONE encoding of that fact: it resolves the canonical path used
 * everywhere below AND is what the entry-import assertion compares against, so
 * the guard and its error hint cannot drift apart.
 */
const REQUIRED_ENTRY_IMPORT = "tooling/tailwind-config/theme.css";

const canonicalTheme = path.join(repoRoot, ...REQUIRED_ENTRY_IMPORT.split("/"));
const dsCssDir = path.join(repoRoot, "packages", "ui", ".ds-css");
const generatedTheme = path.join(dsCssDir, "theme.css");
const stagedTheme = `${generatedTheme}.staged`;
const designSyncDir = path.join(repoRoot, ".design-sync");
const tailwindEntry = path.join(designSyncDir, "tailwind-entry.css");
const compiledCss = path.join(designSyncDir, "compiled-tailwind.css");
const stagedCompiledCss = `${compiledCss}.staged`;
const generatedCompiledCss = path.join(dsCssDir, "compiled-tailwind.css");

/** Opt-in: treat an absent `.design-sync/` as a zero-exit partial run. */
const allowMissingDesignSync = process.argv.includes("--allow-missing-design-sync");

const rel = (p) => path.relative(repoRoot, p);

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;

let stepNo = 0;
function step(title) {
  stepNo += 1;
  console.log(`\n${bold(`[${stepNo}] ${title}`)}`);
}

const discard = (p) => rmSync(p, { force: true });

/**
 * Drop the staging files and the PREVIOUS compiled copy. Called on every path
 * that does not reach a successful compile. Leaving the old
 * `.ds-css/compiled-tailwind.css` in place is the trap this removes: paired with
 * a theme.css regenerated from newer source it is a silently inconsistent pair,
 * and the converter has no way to notice. An ABSENT cssEntry is loud.
 */
function discardStagingAndStaleCompiled() {
  discard(stagedTheme);
  discard(stagedCompiledCss);
  discard(generatedCompiledCss);
}

function fail(message, hint) {
  discardStagingAndStaleCompiled();
  console.error(`\n${red("✖")} ${message}`);
  if (hint) console.error(`  ${hint}`);
  console.error(
    `  ${rel(generatedCompiledCss)} was removed rather than left stale — re-run after fixing.`,
  );
  process.exit(1);
}

/** Run a command with inherited stdio; fail the preflight on non-zero exit. */
function run(cmd, args, { hint } = {}) {
  console.log(`  $ ${cmd} ${args.join(" ")}`);
  const res = spawnSync(cmd, args, { cwd: repoRoot, stdio: "inherit" });
  if (res.error?.code === "ENOENT") fail(`\`${cmd}\` is not installed or not on PATH.`, hint);
  if (res.status !== 0) fail(`\`${cmd} ${args.join(" ")}\` exited with code ${res.status}.`, hint);
}

/**
 * The header stamped onto every generated CSS artifact. A leading CSS comment is
 * inert to both the Tailwind compiler and the design-sync token parser, so the
 * generated file stays a faithful functional copy of its source.
 */
function generatedHeader(sourceRelPath) {
  return `/*
 * GENERATED FILE — DO NOT EDIT.
 *
 * Written by \`pnpm design-sync:preflight\` (scripts/design-sync-preflight.mjs)
 * from ${sourceRelPath}.
 *
 * Any edit made here is OVERWRITTEN on the next run — edit the source file
 * instead, then re-run the preflight.
 *
 * Why this copy exists: .design-sync/config.json's \`tokensGlob\`/\`cssEntry\` must
 * resolve INSIDE packages/ui (out-of-package paths are silently skipped by the
 * converter). Generating it is what keeps it from going stale — ADR 0114 §7.5.
 */
`;
}

// --- [1] The canonical token source ------------------------------------------

step("Locating the canonical token source");

if (!existsSync(canonicalTheme)) {
  fail(
    `The canonical token file is missing: ${rel(canonicalTheme)}.`,
    "It is tracked in git — a clean checkout should always have it.",
  );
}
console.log(`  ${rel(canonicalTheme)} ${green("ok")}`);

// --- [2] Generate packages/ui/.ds-css/theme.css ------------------------------

// This is the load-bearing half of the ADR 0114 §7.5 fix and depends only on
// tracked files, so it works in a fresh clone. It is STAGED, not published:
// publishing it while the compile still has to run (or has just failed) would
// pair a new theme.css with an old compiled-tailwind.css.
step(`Staging ${rel(generatedTheme)} from the canonical source`);

mkdirSync(dsCssDir, { recursive: true });
writeFileSync(
  stagedTheme,
  generatedHeader(rel(canonicalTheme)) + readFileSync(canonicalTheme, "utf8"),
);
console.log(`  staged ${rel(stagedTheme)} ${green("ok")}`);

// --- [3] The entry-import guard ----------------------------------------------

// ADR 0114 §1 picks the in-preflight form of this guard over a tracked test:
// `.design-sync/` is git-excluded, so a test would skip silently in a fresh
// clone and enforce nothing. Absent directory => LOUD skip, never a quiet pass.
step(`Asserting ${rel(tailwindEntry)} imports the canonical theme.css`);

const haveDesignSync = existsSync(designSyncDir);

if (!haveDesignSync) {
  console.log(
    yellow(`  ! SKIPPED — ${rel(designSyncDir)} is not present on this machine.

    That directory is git-excluded (.git/info/exclude), so it is absent from a
    fresh clone and from CI. The entry-import assertion and the Tailwind compile
    below BOTH depend on it and are therefore NOT running. This is a real gap,
    not a pass: run the design-sync tooling to materialise ${rel(designSyncDir)}
    and re-run this preflight before any converter build.

    This run will exit ${allowMissingDesignSync ? "0 (--allow-missing-design-sync)" : "2"}.`),
  );
} else {
  if (!existsSync(tailwindEntry)) {
    fail(
      `${rel(designSyncDir)} exists but ${rel(tailwindEntry)} is missing.`,
      "The compile entry is required — restore it (see .design-sync/NOTES.md) and re-run.",
    );
  }
  // Strip CSS comments FIRST: a commented-out `/* @import "…theme.css"; */`
  // contributes no tokens, so counting it would pass the guard while producing
  // the exact token-less compile the guard exists to catch.
  const entrySource = readFileSync(tailwindEntry, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const imports = [...entrySource.matchAll(/@import\s+["']([^"']+)["']/g)].map((m) => m[1]);
  // Accept either the relative path (what the entry uses today) or the package
  // alias — both land on the same bytes; anything else is not the canonical file.
  // `canonicalTheme` is derived from REQUIRED_ENTRY_IMPORT, so this comparison
  // and the hint below are the same fact, stated once.
  const importsCanonical = imports.some(
    (spec) =>
      path.resolve(designSyncDir, spec) === canonicalTheme ||
      spec === "@repo/tailwind-config/theme",
  );
  if (!importsCanonical) {
    fail(
      `${rel(tailwindEntry)} does not @import the canonical ${rel(canonicalTheme)} (comments excluded).`,
      `Without it the compiled CSS carries no tokens (or stale ones). Found live imports: ${
        imports.length > 0 ? imports.join(", ") : "(none)"
      }. Fix: add \`@import "${path.relative(designSyncDir, canonicalTheme).split(path.sep).join("/")}";\` to the entry.`,
    );
  }
  console.log(`  imports ${rel(canonicalTheme)} ${green("ok")}`);
}

// --- [4] Compile Tailwind and publish the result -----------------------------

step("Compiling Tailwind and publishing the compiled CSS into packages/ui/.ds-css");

if (!haveDesignSync) {
  console.log(yellow(`  ! SKIPPED — see the loud notice above (${rel(designSyncDir)} absent).`));
} else {
  // Pin the CLI to the tailwindcss version this repo actually resolves, so the
  // compiled output can't drift from the version the apps build with. The CLI
  // itself is not a repo dependency (it is only ever needed here) — hence dlx.
  // Resolve from apps/web, the workspace that declares it (catalog:tailwind4) —
  // pnpm does not hoist it to the repo root.
  let tailwindVersion = "4";
  const webTailwindPkg = path.join(
    repoRoot,
    "apps",
    "web",
    "node_modules",
    "tailwindcss",
    "package.json",
  );
  if (existsSync(webTailwindPkg)) {
    tailwindVersion = JSON.parse(readFileSync(webTailwindPkg, "utf8")).version ?? "4";
  } else {
    console.log(
      yellow("  ! tailwindcss is not installed in apps/web — falling back to the @4 tag."),
    );
    console.log(yellow("    (Run `pnpm install` to pin the compile to the repo's own version.)"));
  }

  // Compile to a staging path so a crashed/partial CLI run never lands on the
  // artifact the converter reads.
  run(
    "pnpm",
    [
      "dlx",
      `@tailwindcss/cli@${tailwindVersion}`,
      "-i",
      rel(tailwindEntry),
      "-o",
      rel(stagedCompiledCss),
    ],
    { hint: "`pnpm dlx` needs network access on first run (the CLI is not a repo dependency)." },
  );

  if (!existsSync(stagedCompiledCss)) {
    fail(
      `The Tailwind CLI exited 0 but produced no ${rel(stagedCompiledCss)}.`,
      "Nothing was published — the previous compiled copy was removed rather than left stale.",
    );
  }

  // --- Publish. Only now, with a good compile in hand, do the two coupled
  // artifacts move into place together.
  renameSync(stagedCompiledCss, compiledCss);
  copyFileSync(compiledCss, generatedCompiledCss);
  renameSync(stagedTheme, generatedTheme);
  console.log(`  wrote ${rel(compiledCss)} ${green("ok")}`);
  console.log(`  wrote ${rel(generatedCompiledCss)} ${green("ok")}`);
  console.log(`  wrote ${rel(generatedTheme)} ${green("ok")}`);
}

// --- Done ---------------------------------------------------------------------

if (haveDesignSync) {
  console.log(`\n${green(bold("✔ Design-sync preflight complete."))}
  Both ${bold("tokensGlob")} and ${bold("cssEntry")} are now derived from source.
  Next: run the design-sync converter build.`);
  process.exit(0);
}

// Absent `.design-sync/`: the guard and the compile did not run, so there is no
// verified pipeline to hand to a converter build. Publish nothing and remove the
// stale compiled copy — an ABSENT cssEntry is loud, a stale one is not — then
// exit non-zero so callers that key on the status code see the partial run.
discardStagingAndStaleCompiled();

console.log(`\n${yellow(bold("⚠ Design-sync preflight did NOT complete."))}
  ${rel(designSyncDir)} is absent on this machine, so the entry-import guard and
  the Tailwind compile did not run. Nothing was published: the staged theme.css
  was dropped and any stale ${rel(generatedCompiledCss)} was REMOVED, so the
  converter fails loudly on a missing cssEntry instead of silently consuming a
  stale one. Do not treat this as a verified pipeline.`);

if (allowMissingDesignSync) {
  console.log(`  ${yellow("Exiting 0 because --allow-missing-design-sync was passed.")}`);
  process.exit(0);
}

console.error(
  `\n${red("✖")} Exiting 2 — the preflight enforced nothing.
  Pass ${bold("--allow-missing-design-sync")} if a partial run is acceptable to this caller.`,
);
process.exit(2);
