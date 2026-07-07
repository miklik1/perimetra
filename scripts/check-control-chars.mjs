#!/usr/bin/env node
// Reject raw control bytes in tracked text/source files.
//
// Why this exists: a single literal 0x00 (NUL) byte makes git classify a
// source file BINARY — `git diff` / `gh pr diff` then render no content for
// it, so every diff-based review, blame, and future archaeology silently
// skips the file (observed in the wild: a NUL used as a composite-key
// separator in a template literal shipped invisible to review). Control
// characters belong in source as escape sequences ("\x00", "\u001b"), never
// as the raw byte.
//
// Usage:
//   node scripts/check-control-chars.mjs             # all tracked files (CI)
//   node scripts/check-control-chars.mjs --staged    # staged files (pre-commit)
//   node scripts/check-control-chars.mjs <files...>  # just these
//
// Coverage is a DENYLIST of known-binary extensions, not an allowlist of
// source extensions: everything tracked gets scanned unless its extension is
// listed below. A new binary asset type therefore fails LOUD (add it here);
// a new source-like extension (.hbs, .prisma, Dockerfile, .env.example,
// extensionless scripts) is covered by default instead of silently skipped —
// silent skips are exactly the failure mode this guard exists to kill.
//
// Allowed control bytes: tab (0x09), LF (0x0A), CR (0x0D). Anything else in
// 0x00-0x1F, plus DEL (0x7F), fails the check. Bytes >= 0x80 are UTF-8
// sequences and are fine. Dependency-free (Node stdlib only).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Legitimately-binary extensions, skipped. Everything else is scanned.
const BINARY_EXTENSIONS = new Set([
  // images
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".bmp",
  ".ico",
  ".icns",
  // fonts
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  // audio/video/animation
  ".mp3",
  ".mp4",
  ".webm",
  ".ogg",
  ".wav",
  ".mov",
  ".riv",
  ".lottie",
  // archives, documents, keys
  ".zip",
  ".gz",
  ".tgz",
  ".tar",
  ".jar",
  ".pdf",
  ".keystore",
  ".jks",
  ".p8",
  ".p12",
  ".der",
  // compiled artifacts
  ".node",
  ".wasm",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".class",
  // databases
  ".db",
  ".sqlite",
]);

const ALLOWED = new Set([0x09, 0x0a, 0x0d]); // tab, LF, CR

/** @returns {{ line: number, col: number, byte: number }[]} first offenders */
function scan(buf, limit = 5) {
  const hits = [];
  let line = 1;
  let col = 1;
  for (let i = 0; i < buf.length && hits.length < limit; i++) {
    const b = buf[i];
    if ((b < 0x20 && !ALLOWED.has(b)) || b === 0x7f) {
      hits.push({ line, col, byte: b });
    }
    if (b === 0x0a) {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  return hits;
}

/** @returns {string[]} repo-relative paths from git, NUL-delimited command */
function gitFiles(gitArgs) {
  return execFileSync("git", [...gitArgs, "-z"], { cwd: repoRoot, encoding: "utf8" })
    .split("\0")
    .filter(Boolean)
    .map((f) => resolve(repoRoot, f));
}

const args = process.argv.slice(2);
// --staged asks git itself for the staged file list instead of taking paths
// on argv — immune to ARG_MAX on huge commits and needs no glob to maintain.
const candidates =
  args[0] === "--staged"
    ? gitFiles(["diff", "--cached", "--name-only", "--diff-filter=d"])
    : args.length > 0
      ? args
      : gitFiles(["ls-files"]);

let failed = false;
for (const file of candidates) {
  const abs = resolve(repoRoot, file);
  if (BINARY_EXTENSIONS.has(extname(abs).toLowerCase())) continue;
  let buf;
  try {
    buf = readFileSync(abs);
  } catch {
    continue; // deleted/renamed since staging, or a directory — nothing to scan
  }
  const hits = scan(buf);
  if (hits.length === 0) continue;
  failed = true;
  const rel = relative(repoRoot, abs);
  for (const { line, col, byte } of hits) {
    const hex = `0x${byte.toString(16).padStart(2, "0").toUpperCase()}`;
    console.error(`${rel}:${line}:${col} raw control byte ${hex}`);
  }
}

if (failed) {
  console.error(
    "\nRaw control bytes make git treat a source file as binary, hiding it from " +
      "diff-based review. Replace them with escape sequences (\\x00, \\u001b) or a " +
      "printable separator. Legitimately-binary asset types belong in " +
      "BINARY_EXTENSIONS in this script.",
  );
  process.exit(1);
}
