#!/usr/bin/env node
/**
 * Offline ADR link check (ADR 1046 / web-native ADR 1040).
 *
 * Two passes, both purely local — no network, no deps (Node stdlib only, like
 * `scripts/check-no-orphan-rn.mjs`):
 *
 *   1. RELATIVE LINKS INSIDE `docs/adr/*.md`. Every `](target)` whose target is
 *      a repo-relative path must resolve to a file that exists.
 *   2. ADR CITATIONS OUTSIDE `docs/`. Any `docs/adr/<something>.md` string
 *      appearing in a script, workflow, config or source file must resolve too.
 *
 * Pass 2 is the one that pays for this script's existence. The defect that
 * prompted it was a citation printed by the gitleaks pin guard's own FAILURE
 * message — `docs/adr/1033-gitleaks-pinned-by-sha256-digest.md`, a file that
 * does not exist (the ADR is 1028; 1033 is an unrelated decision). A dangling
 * pointer there is worse than a dangling pointer in prose: it is read by
 * somebody at the exact moment a security control has just failed, and it sends
 * them to a file that is not the argument for the control they are looking at.
 *
 * WHY THIS IS NOT A LINK CHECKER IN THE USUAL SENSE. It deliberately does NOT
 * resolve http(s) links, anchors, or `[text][ref]` reference-style links. Those
 * need the network, or a markdown parser, or both — and a check that needs the
 * network cannot run in a Stop hook, which is the whole point of the class of
 * defect this catches (a rename lands, the reference rots, nothing local
 * notices). Narrow and offline beats broad and unrunnable.
 *
 * Glob citations (`docs/adr/1031-*.md`) are supported, because prose in this
 * repo genuinely uses them to cite an ADR without pinning its slug — they
 * resolve if at least one file matches the prefix.
 *
 * Run: node scripts/check-adr-links.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const adrDir = join(repoRoot, "docs", "adr");

// Directories that are never ours to check.
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".turbo",
  ".next",
  "dist",
  "build",
  "coverage",
  "android",
  "ios",
]);

// Paths a GENERATOR writes into a DERIVED repo, which therefore must NOT exist
// here. `scripts/create-project` stamps `docs/adr/0000-inherited-from-skeleton.md`
// into the new project; asserting it resolves in the skeleton asserts the wrong
// thing about the wrong tree.
//
// This is keyed on the TARGET path, never on the file that mentions it — a
// per-file exemption would silently cover a real dangling citation that happens
// to live in the same generator. Every entry is a path this repo deliberately
// does not contain.
const GENERATED_TARGETS = new Set(["docs/adr/0000-inherited-from-skeleton.md"]);

// Pass 2 reads these extensions. Deliberately NOT `.md`: documentation prose
// outside docs/adr cites ADRs loosely ("see ADR 1028"), and turning that into a
// gate would mean policing prose rather than pointers.
const CODE_EXTENSIONS = /\.(mjs|cjs|js|ts|tsx|json|ya?ml|sh)$/;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".github") continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function exists(path) {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

/** A citation may end in `*.md`; resolve it by prefix against docs/adr. */
function resolvesAsGlob(target) {
  const star = target.indexOf("*");
  if (star === -1) return false;
  const prefix = target.slice(0, star);
  const absPrefix = resolve(repoRoot, prefix);
  const dir = dirname(absPrefix);
  if (!exists(dir)) return false;
  const base = absPrefix.slice(dir.length + 1);
  return readdirSync(dir).some((name) => name.startsWith(base));
}

const failures = [];

// ── Pass 1: relative links inside docs/adr/*.md ─────────────────────────────
if (!exists(adrDir)) {
  console.error(`check-adr-links: ${relative(repoRoot, adrDir)} does not exist`);
  process.exit(2);
}
const adrFiles = readdirSync(adrDir).filter((name) => name.endsWith(".md"));
// A vacuous pass is the failure mode of a derived check: if the directory is
// empty or the read silently returns nothing, this must be loud, not green.
if (adrFiles.length === 0) {
  console.error("check-adr-links: docs/adr contains no .md files — nothing was checked");
  process.exit(2);
}

const MD_LINK = /\]\(([^)\s]+)\)/g;

// A link inside CODE is not a link. These ADRs quote markdown at each other —
// this very file's ADR shows `[bogus](9999-does-not-exist.md)` as the disarm
// example and `](target)` as the pattern being matched — so scanning raw source
// makes the check red on its own documentation, which is the fastest way to get
// a check deleted. Fenced blocks first (they may contain backticks), then inline
// spans. Replaced with a same-length-ish blank rather than removed so nothing
// downstream depends on offsets.
function stripCode(markdown) {
  return markdown.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
}

let linkCount = 0;
for (const name of adrFiles) {
  const source = stripCode(readFileSync(join(adrDir, name), "utf8"));
  for (const match of source.matchAll(MD_LINK)) {
    const target = match[1];
    if (!target || /^(https?:|mailto:|#)/.test(target)) continue;
    const clean = target.split("#")[0];
    if (!clean) continue; // a pure anchor
    linkCount += 1;
    if (!exists(resolve(adrDir, clean))) {
      failures.push(`docs/adr/${name} → ${target}`);
    }
  }
}

// ── Pass 2: `docs/adr/...md` citations anywhere outside docs/ ───────────────
const CITATION = /docs\/adr\/[A-Za-z0-9._*-]+\.md/g;
let citationCount = 0;
for (const file of walk(repoRoot)) {
  const rel = relative(repoRoot, file);
  if (rel.startsWith("docs/")) continue; // pass 1 owns docs/adr; other docs are prose
  if (!CODE_EXTENSIONS.test(rel)) continue;
  // This file is full of example citations by construction.
  if (rel === join("scripts", "check-adr-links.mjs")) continue;
  let source;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    continue; // unreadable or binary — not this check's business
  }
  for (const target of source.match(CITATION) ?? []) {
    citationCount += 1;
    if (GENERATED_TARGETS.has(target)) continue;
    if (exists(resolve(repoRoot, target))) continue;
    if (resolvesAsGlob(target)) continue;
    failures.push(`${rel} → ${target}`);
  }
}

if (failures.length > 0) {
  console.error(
    `\ncheck-adr-links: ${failures.length} dangling ADR reference${failures.length === 1 ? "" : "s"}:\n`,
  );
  for (const failure of failures) console.error(`  ${failure}`);
  console.error(
    "\nFix the path, or the ADR was renumbered and the citation was not moved with it.\n",
  );
  process.exit(1);
}

console.log(
  `check-adr-links: OK — ${linkCount} relative links in ${adrFiles.length} ADRs, ` +
    `${citationCount} citations outside docs/, 0 dangling.`,
);
