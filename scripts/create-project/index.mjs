#!/usr/bin/env node
// scripts/create-project — stamp a derived project out of the skeleton.
// ADR 0042; spec §4 (template lifecycle). Run from a fresh clone of the
// skeleton:
//
//   node scripts/create-project                 # interactive
//   node scripts/create-project --name acme-app # non-interactive
//
// What it does (and deliberately does NOT do):
//   1. Sets the root package.json `name` and records provenance in a
//      `skeleton` field: { repo, baseCommit, createdAt }. `baseCommit` is the
//      anchor for the upstream-merge channel (docs/managing-updates.md).
//   2. Generates strong secrets: BETTER_AUTH_SECRET into apps/api/.env.local,
//      Centrifugo HMAC token secret + HTTP API key into BOTH
//      apps/api/.env.local and docker/centrifugo/config.json (they must
//      match), and scaffolds apps/web/.env.local.
//   3. Writes docs/adr/0000-inherited-from-skeleton.md — a marker listing the
//      ADRs inherited from the skeleton at the recorded base commit. The
//      inherited ADRs themselves are KEPT: they document the architecture the
//      derived project runs on. New decisions start at 0045.
//   4. Does NOT rename the @repo workspace scope. Keeping @repo is a design
//      decision (ADR 0042): scope-stable files diff cleanly against the
//      skeleton remote, so upstream merges stay conflict-free. A scope rename
//      would touch every package.json + import and poison that channel.
//   5. Optionally (--fresh-history) re-initializes git history with a single
//      provenance commit.
//
// Plain Node (stdlib only, no dependencies) — runs before `pnpm install`.
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const USAGE = `Usage: node scripts/create-project [options]

Options:
  --name <project-name>    npm-style name for the root package (prompted if omitted)
  --skeleton-repo <url>    skeleton repo URL recorded in package.json#skeleton
                           (default: this clone's "origin" remote)
  --base-commit <sha>      skeleton commit recorded as the merge anchor
                           (default: git rev-parse HEAD)
  --created-at <iso8601>   timestamp recorded in package.json#skeleton
                           (default: now)
  --fresh-history          delete .git and re-init with one provenance commit
  --force                  overwrite existing .env.local files / re-stamp
  --help                   show this help

The @repo workspace scope is intentionally NOT renamed — see ADR 0042.`;

// ---------------------------------------------------------------------------
// argv parsing (stdlib only)
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const flags = {
    name: undefined,
    skeletonRepo: undefined,
    baseCommit: undefined,
    createdAt: undefined,
    freshHistory: false,
    force: false,
    help: false,
  };
  const takesValue = {
    "--name": "name",
    "--skeleton-repo": "skeletonRepo",
    "--base-commit": "baseCommit",
    "--created-at": "createdAt",
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") flags.help = true;
    else if (arg === "--fresh-history") flags.freshHistory = true;
    else if (arg === "--force") flags.force = true;
    else if (arg === "--scope") {
      fail(
        `--scope is not supported: the @repo workspace scope intentionally stays.\n` +
          `Renaming it would touch every package.json and import in the tree and\n` +
          `break the upstream-merge update channel (ADR 0042,\n` +
          `docs/managing-updates.md). Your project identity is the root package\n` +
          `name + app display names, not the internal scope.`,
      );
    } else if (arg in takesValue) {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--")) {
        fail(`Missing value for ${arg}\n\n${USAGE}`);
      }
      flags[takesValue[arg]] = value;
    } else {
      fail(`Unknown option: ${arg}\n\n${USAGE}`);
    }
  }
  return flags;
}

function fail(message) {
  console.error(`\ncreate-project: ${message}`);
  process.exit(1);
}

// npm package name (unscoped — the root package is private, keep it simple).
const NAME_RE = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;

function validateName(name) {
  if (!NAME_RE.test(name) || name.length > 214) {
    fail(
      `Invalid project name "${name}". Use lowercase letters, digits, "-", "_",\n` +
        `"." — starting and ending alphanumeric (npm package name rules).`,
    );
  }
  return name;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function git(args, { allowFail = false } = {}) {
  try {
    return execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    if (allowFail) return undefined;
    throw error;
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** openssl-rand-base64-32 equivalent; base64url keeps env files quote-free. */
function generateSecret() {
  return randomBytes(32).toString("base64url");
}

function writeEnvFile(path, content, force) {
  if (existsSync(path) && !force) {
    fail(
      `${path} already exists — refusing to overwrite generated secrets.\n` +
        `Re-run with --force to replace it.`,
    );
  }
  writeFileSync(path, content);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const flags = parseArgs(process.argv.slice(2));
if (flags.help) {
  console.log(USAGE);
  process.exit(0);
}

const pkgPath = join(repoRoot, "package.json");
const pkg = readJson(pkgPath);

if (pkg.skeleton && !flags.force) {
  fail(
    `this tree is already stamped (package.json has a "skeleton" field:\n` +
      `  ${JSON.stringify(pkg.skeleton)}\n` +
      `create-project runs once, on a fresh clone of the skeleton. Use --force\n` +
      `only if you know what you are doing.`,
  );
}

// 0. Resolve inputs — provenance BEFORE any mutation (and before any
//    --fresh-history git deletion).
let name = flags.name;
if (!name) {
  if (!process.stdin.isTTY) {
    fail(`--name is required when not running interactively.\n\n${USAGE}`);
  }
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  name = (await rl.question("Project name (root package.json name): ")).trim();
  rl.close();
}
validateName(name);

// Per-project host-port offset. Every repo stamped from this skeleton would
// otherwise publish its dev containers on the SAME host ports (the compose
// defaults) and run its apps on the SAME ports (api 4000 / web 3000), so two
// on one machine collide — at best a loud EADDRINUSE, at worst a migrate
// pointed at another project's database (the incident behind this fix). We
// derive a deterministic offset from the project name (stable across
// re-stamps) and shift EVERY service by it, preserving inter-service gaps.
// Range 1..50 keeps ports tidy and never lands on +0 (the bare defaults, left
// to whichever repo wants them). Best-effort: two names can hash to the same
// offset — if so, hand-edit the colliding *_HOST_PORT in docker/.env and its
// matching connection string in apps/api/.env.local.
const portOffset = (createHash("sha256").update(name).digest().readUInt16BE(0) % 50) + 1;
const port = {
  pg: 5432 + portOffset,
  redis: 6379 + portOffset,
  centrifugo: 8000 + portOffset,
  minioApi: 9000 + portOffset,
  minioConsole: 9001 + portOffset,
  mailpitSmtp: 1025 + portOffset,
  mailpitWeb: 8025 + portOffset,
  pgbouncer: 6432 + portOffset,
  api: 4000 + portOffset,
  web: 3000 + portOffset,
};

const baseCommit =
  flags.baseCommit ??
  git(["rev-parse", "HEAD"], { allowFail: true }) ??
  fail(
    `cannot resolve the skeleton base commit (not a git clone?). Pass\n` +
      `--base-commit <sha> explicitly — the commit anchors all future upstream\n` +
      `merges (docs/managing-updates.md).`,
  );

const skeletonRepo =
  flags.skeletonRepo ??
  git(["remote", "get-url", "origin"], { allowFail: true }) ??
  "https://github.com/miklik1/fullstack-skeleton";

// User-run script: wall-clock is fine; --created-at exists for reproducibility.
const createdAt = flags.createdAt ?? new Date().toISOString();

// Preflight: fail BEFORE mutating anything.
const apiEnvPath = join(repoRoot, "apps/api/.env.local");
const webEnvPath = join(repoRoot, "apps/web/.env.local");
if (!flags.force) {
  for (const path of [apiEnvPath, webEnvPath]) {
    if (existsSync(path)) {
      fail(
        `${path} already exists — refusing to overwrite generated secrets.\n` +
          `Re-run with --force to replace it.`,
      );
    }
  }
}

console.log(`\nStamping "${name}" out of the skeleton`);
console.log(`  skeleton repo : ${skeletonRepo}`);
console.log(`  base commit   : ${baseCommit}`);
console.log(`  created at    : ${createdAt}\n`);

// 1. Root package.json — name + skeleton provenance field.
pkg.name = name;
pkg.skeleton = { repo: skeletonRepo, baseCommit, createdAt };
writeJson(pkgPath, pkg);
console.log(`  ✔ package.json — name set, skeleton field written`);

// 2. Secrets. Centrifugo values are written to BOTH the api env and the
//    Centrifugo container config — they authenticate the same two channels
//    (HTTP API key: api → Centrifugo; HMAC secret: JWTs the api mints for
//    clients), so the pairs must match.
const betterAuthSecret = generateSecret();
const centrifugoApiKey = generateSecret();
const centrifugoTokenSecret = generateSecret();

writeEnvFile(
  apiEnvPath,
  `# Generated by \`node scripts/create-project\` on ${createdAt}.
# Gitignored. See apps/api/.env.example for every available variable —
# the dev defaults there match docker/compose.yaml, so only secrets live here.

# Better Auth signing/encryption secret (ADR 0033). Rotating it invalidates
# every session.
BETTER_AUTH_SECRET=${betterAuthSecret}

# Centrifugo (ADR 0035; spec §7.3). MUST match docker/centrifugo/config.json
# (\`http_api.key\` / \`client.token.hmac_secret_key\`) — create-project keeps
# the two files in sync; if you rotate one side, rotate the other.
CENTRIFUGO_API_KEY=${centrifugoApiKey}
CENTRIFUGO_TOKEN_SECRET=${centrifugoTokenSecret}

# Host-port remap — mirrors docker/.env (offset ${portOffset}). Pins every
# connection string that would otherwise fall back to the env.ts compose
# defaults, which another stamped repo on this machine may be using. Never edit
# the env.ts defaults — CI + fresh clones must stay on them.
PORT=${port.api}
DATABASE_URL=postgres://app:app@localhost:${port.pg}/app
REDIS_URL=redis://localhost:${port.redis}
CENTRIFUGO_URL=http://localhost:${port.centrifugo}
S3_ENDPOINT=http://localhost:${port.minioApi}
SMTP_HOST=localhost
SMTP_PORT=${port.mailpitSmtp}
BETTER_AUTH_URL=http://localhost:${port.api}
WEB_ORIGIN=http://localhost:${port.web}
`,
  flags.force,
);
console.log(`  ✔ apps/api/.env.local — secrets + host-port remap (offset ${portOffset})`);

writeEnvFile(
  webEnvPath,
  `# Generated by \`node scripts/create-project\` on ${createdAt}.
# Gitignored. The web app holds NO server secrets by design (the api owns
# them; web talks to it via the same-origin BFF proxy — ADR 0018/0026).
# See apps/web/.env.example for every available variable. Uncomment API_URL to
# leave mock mode and target the local api (it runs on the remapped port below).
# API_URL=http://localhost:${port.api}

# Web dev port: Next ignores PORT from .env.local for the dev server, so the
# apps/web \`dev\` script reads the WEB_PORT shell var (default 3000; turbo passes
# it through). Run the web on this stamp's port to coexist with other stamps:
#   WEB_PORT=${port.web} pnpm dev          (or WEB_PORT=${port.web} pnpm dev:web)

# Centrifugo websocket for the LIVE badge — mirrors docker/.env (offset ${portOffset}).
NEXT_PUBLIC_REALTIME_URL=ws://localhost:${port.centrifugo}/connection/websocket
`,
  flags.force,
);
console.log(`  ✔ apps/web/.env.local — scaffolded (api → :${port.api}, web dev port :${port.web})`);

// Compose project name + host-port remap: docker/compose.yaml hardcodes
// `name: fullstack-skeleton` AND defaults every host port (5432/6379/8000/
// 9000/9001/1025/8025/6432), so two repos stamped from the skeleton on one
// machine would otherwise share/recreate each other's containers and fight
// over ports. COMPOSE_PROJECT_NAME (precedence: -p flag > env var > name: >
// directory) namespaces the stack; the *_HOST_PORT vars feed compose.yaml's
// `${VAR:-default}` interpolation, shifting every published port by the
// per-project offset.
writeEnvFile(
  join(repoRoot, "docker/.env"),
  `# Generated by \`node scripts/create-project\` on ${createdAt}.
# Gitignored. Namespaces this project's dev containers AND remaps every host
# port off the compose defaults so repos stamped from the same skeleton coexist
# on one machine. Offset ${portOffset} is derived deterministically from the
# project name (every service shifts by the same amount, preserving gaps).
# apps/api/.env.local + apps/web/.env.local mirror these ports — keep them in
# sync; hand-edit any line that still collides with another project.
COMPOSE_PROJECT_NAME=${name}

POSTGRES_HOST_PORT=${port.pg}
REDIS_HOST_PORT=${port.redis}
CENTRIFUGO_HOST_PORT=${port.centrifugo}
MINIO_API_HOST_PORT=${port.minioApi}
MINIO_CONSOLE_HOST_PORT=${port.minioConsole}
MAILPIT_SMTP_HOST_PORT=${port.mailpitSmtp}
MAILPIT_WEB_HOST_PORT=${port.mailpitWeb}
PGBOUNCER_HOST_PORT=${port.pgbouncer}
`,
  flags.force,
);
console.log(`  ✔ docker/.env — COMPOSE_PROJECT_NAME=${name} + host ports (offset ${portOffset})`);

const centrifugoConfigPath = join(repoRoot, "docker/centrifugo/config.json");
const centrifugoConfig = readJson(centrifugoConfigPath);
centrifugoConfig.client ??= {};
centrifugoConfig.client.token ??= {};
centrifugoConfig.client.token.hmac_secret_key = centrifugoTokenSecret;
// allowed_origins gates the WS upgrade against the browser Origin header. The
// committed config ships localhost:3000; a stamp whose web runs on the offset
// port (e.g. :3002) would get a 403 unless we rewrite it to this stamp's web
// origin here. (Stays committed, so a fresh clone already has the right value.)
centrifugoConfig.client.allowed_origins = [`http://localhost:${port.web}`];
centrifugoConfig.http_api ??= {};
centrifugoConfig.http_api.key = centrifugoApiKey;
writeJson(centrifugoConfigPath, centrifugoConfig);
console.log(`  ✔ docker/centrifugo/config.json — secrets rotated + allowed_origins → :${port.web}`);

// 3. ADR provenance marker. Inherited ADRs are KEPT (they document the
//    architecture this project runs on); the marker records where they came
//    from and where new ones start.
const adrDir = join(repoRoot, "docs/adr");
const inheritedAdrs = readdirSync(adrDir)
  .filter((f) => /^\d{4}-.+\.md$/.test(f) && !f.startsWith("0000-"))
  .sort();
const highest = inheritedAdrs.at(-1)?.slice(0, 4) ?? "0044";
const nextAdr = String(Number(highest) + 1).padStart(4, "0");
writeFileSync(
  join(adrDir, "0000-inherited-from-skeleton.md"),
  `# ADR 0000 — Inherited from fullstack-skeleton

**Status:** Accepted (${createdAt.slice(0, 10)}). Provenance marker.

This project was stamped out of the skeleton by \`scripts/create-project\`:

- **Skeleton repo:** ${skeletonRepo}
- **Base commit:** ${
    skeletonRepo.includes("github.com")
      ? `[\`${baseCommit.slice(0, 12)}\`](${skeletonRepo
          .replace(/^git@github\.com:/, "https://github.com/")
          .replace(/\.git$/, "")}/commit/${baseCommit})`
      : `\`${baseCommit}\``
  } (also recorded in \`package.json#skeleton.baseCommit\`)
- **Created:** ${createdAt}

ADRs ${inheritedAdrs[0]?.slice(0, 4) ?? "0001"}–${highest} below are inherited
from the skeleton at that commit. They are kept — they document the
architecture this project runs on — and remain skeleton-owned: upstream merges
may update them, so do not edit them here (supersede instead).

**New decisions in this project start at ADR ${nextAdr}** and are owned by this
repo (never touched by upstream merges — see \`docs/managing-updates.md\`).

Inherited ADRs (${inheritedAdrs.length}):

${inheritedAdrs.map((f) => `- ${f}`).join("\n")}
`,
);
console.log(
  `  ✔ docs/adr/0000-inherited-from-skeleton.md — ${inheritedAdrs.length} inherited ADRs recorded, new ones start at ${nextAdr}`,
);

// 4. Optional fresh git history.
if (flags.freshHistory) {
  rmSync(join(repoRoot, ".git"), { recursive: true, force: true });
  git(["init", "--initial-branch=main"]);
  // Keep the script runnable on machines without a global git identity.
  const identity = git(["config", "user.email"], { allowFail: true })
    ? []
    : ["-c", "user.name=create-project", "-c", "user.email=create-project@localhost"];
  execFileSync("git", [...identity, "add", "--all"], { cwd: repoRoot });
  execFileSync(
    "git",
    [
      ...identity,
      "commit",
      "--quiet",
      "-m",
      `chore: stamp ${name} from fullstack-skeleton\n\nSkeleton: ${skeletonRepo}\nBase commit: ${baseCommit}\nCreated: ${createdAt}\nGenerated by scripts/create-project (ADR 0042).`,
    ],
    { cwd: repoRoot },
  );
  console.log(`  ✔ git history re-initialized (single provenance commit on main)`);
} else {
  console.log(
    `  ◦ git history kept (full skeleton history aids \`git log\` archaeology;\n` +
      `    re-run nothing — just know --fresh-history existed if you wanted a clean slate)`,
  );
}

// 5. Post-create checklist.
console.log(`
Done. ${name} is stamped. Post-create checklist:

  1. Wire the upstream channel (docs/managing-updates.md):
       git remote add skeleton ${skeletonRepo}
  2. Rename user-facing display names (the @repo scope stays — ADR 0042):
       apps/web   — app title/metadata (apps/web/src/app/layout.tsx, manifest)
       apps/mobile — app.config.ts (name, slug, bundle ids)
  3. Point Renovate at the shared preset (renovate.json already extends it —
     verify the Renovate app is installed on the new repo).
  4. Fill real service keys when ready (all optional; everything boots without
     them): Sentry DSNs, PostHog keys (api + web .env.local), SMTP + S3
     credentials for non-local environments.
  5. Pick the deploy target and adjust docker/api.Dockerfile env + CI deploy
     steps; production secrets go to the platform's secret store, never to git.
  6. pnpm install && pnpm dev — then read CONTRIBUTING.md and ARCHITECTURE.md.
`);
