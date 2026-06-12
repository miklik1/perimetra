#!/usr/bin/env node
// Guard against orphan stale `react-native` / `@react-native/*` directories in
// node_modules.
//
// Why this exists: a `node-linker=hoisted` experiment once left a full RN
// 0.83/0.84 tree at the repo-root `node_modules/` as REAL directories. pnpm only
// manages its own symlinks, so a later `pnpm install` (back on the default
// symlinked linker) could not remove those untracked dirs — they silently
// shadowed the correct nested `@react-native/codegen`, and Metro's codegen babel
// plugin then failed parsing RN 0.85 specs:
//   "Unable to determine event arguments for \"onModeChange\""
//   "Unsupported param type ... Found ReadonlyArray"
//
// Invariant: under a strict-pnpm install, every `react-native` /
// `@react-native/*` entry that lives directly in a `node_modules/` (i.e. NOT
// inside `node_modules/.pnpm/`) is a SYMLINK into the store. A real directory
// there is orphan residue. This script asserts that and exits non-zero if any
// orphan is found. Dependency-free (Node stdlib only); safe to run pre-install.
import { lstatSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// node_modules roots to inspect: the repo root plus each app workspace (where RN
// actually resolves). Missing dirs are fine — absence means nothing to check.
const nmRoots = [
  join(repoRoot, "node_modules"),
  join(repoRoot, "apps/mobile/node_modules"),
  join(repoRoot, "apps/web/node_modules"),
];

/** A directory entry that is a real dir (not a symlink) is an orphan. */
function isOrphanDir(path) {
  let st;
  try {
    st = lstatSync(path);
  } catch {
    return false; // doesn't exist → nothing to flag
  }
  return st.isDirectory(); // lstat does not follow symlinks, so a symlink → false
}

const orphans = [];

for (const nm of nmRoots) {
  // `react-native` itself
  if (isOrphanDir(join(nm, "react-native"))) orphans.push(join(nm, "react-native"));

  // every package under the `@react-native` scope
  const scope = join(nm, "@react-native");
  let entries;
  try {
    entries = readdirSync(scope, { withFileTypes: true });
  } catch {
    continue; // scope dir absent → skip
  }
  for (const e of entries) {
    const p = join(scope, e.name);
    if (isOrphanDir(p)) orphans.push(p);
  }
}

if (orphans.length > 0) {
  console.error("✖ Orphan react-native dirs in node_modules (not pnpm symlinks):");
  for (const o of orphans) console.error("  " + o);
  console.error(
    "\nThese are stale residue (often from a node-linker=hoisted run) and can\n" +
      "shadow the correct @react-native/codegen, breaking the mobile build. Fix:\n" +
      "  rm -rf node_modules apps/*/node_modules packages/*/node_modules tooling/*/node_modules \\\n" +
      "    apps/mobile/.expo node_modules/.cache .turbo/cache\n" +
      "  pnpm install",
  );
  process.exit(1);
}

console.log("✓ no orphan react-native dirs in node_modules");
