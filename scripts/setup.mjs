#!/usr/bin/env node
/**
 * One-command local bootstrap (spec §12): `pnpm run setup` (or `node scripts/setup.mjs`).
 * The explicit `run` matters: pnpm's builtin `setup` command shadows the bare form.
 *
 * Checks toolchain versions, starts the docker compose infrastructure,
 * installs dependencies, builds the api graph, and runs migrations.
 * Idempotent by construction — every step is a no-op when already done, so
 * re-running it on a live stack is safe (and the way to "repair" a half
 * set-up checkout).
 *
 * No npm dependencies: this must run BEFORE `pnpm install` has ever happened.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const composeFile = path.join(repoRoot, "docker", "compose.yaml");

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;

let stepNo = 0;
function step(title) {
  stepNo += 1;
  console.log(`\n${bold(`[${stepNo}] ${title}`)}`);
}

function fail(message, hint) {
  console.error(`\n${red("✖")} ${message}`);
  if (hint) console.error(`  ${hint}`);
  process.exit(1);
}

/** Run a command with inherited stdio; fail the bootstrap on non-zero exit. */
function run(cmd, args, { hint } = {}) {
  console.log(`  $ ${cmd} ${args.join(" ")}`);
  const res = spawnSync(cmd, args, { cwd: repoRoot, stdio: "inherit" });
  if (res.error?.code === "ENOENT") fail(`\`${cmd}\` is not installed or not on PATH.`, hint);
  if (res.status !== 0) fail(`\`${cmd} ${args.join(" ")}\` exited with code ${res.status}.`, hint);
}

/** Run a command silently, returning stdout or null on any failure. */
function capture(cmd, args) {
  const res = spawnSync(cmd, args, { cwd: repoRoot, encoding: "utf8" });
  return res.status === 0 ? res.stdout.trim() : null;
}

// --- [1] Toolchain versions -------------------------------------------------

step("Checking toolchain (node, pnpm, docker)");

const wantedNodeMajor = Number.parseInt(
  readFileSync(path.join(repoRoot, ".nvmrc"), "utf8").trim(),
  10,
);
const nodeMajor = Number.parseInt(process.versions.node.split(".")[0], 10);
if (nodeMajor < wantedNodeMajor) {
  fail(
    `Node ${process.versions.node} is too old — this repo targets Node ${wantedNodeMajor} (.nvmrc).`,
    `Fix: \`fnm use\` / \`nvm use\` in the repo root, then re-run.`,
  );
}
if (nodeMajor > wantedNodeMajor) {
  console.log(
    yellow(
      `  ! Node ${process.versions.node} is newer than .nvmrc (${wantedNodeMajor}) — untested.`,
    ),
  );
}
console.log(`  node ${process.versions.node} ${green("ok")}`);

const pnpmVersion = capture("pnpm", ["--version"]);
if (!pnpmVersion) {
  fail("pnpm is not installed or not on PATH.", "Fix: `corepack enable` (ships with Node).");
}
const pinnedPnpm = JSON.parse(
  readFileSync(path.join(repoRoot, "package.json"), "utf8"),
).packageManager?.split("@")[1];
if (pinnedPnpm && pnpmVersion.split(".")[0] !== pinnedPnpm.split(".")[0]) {
  console.log(
    yellow(
      `  ! pnpm ${pnpmVersion} differs from the pinned ${pinnedPnpm} — corepack normally handles this.`,
    ),
  );
}
console.log(`  pnpm ${pnpmVersion} ${green("ok")}`);

if (!capture("docker", ["--version"])) {
  fail("docker is not installed or not on PATH.", "Install Docker Desktop / Engine + compose v2.");
}
if (spawnSync("docker", ["info"], { stdio: "ignore" }).status !== 0) {
  fail("The Docker daemon is not running (`docker info` failed).", "Start Docker, then re-run.");
}
console.log(`  docker daemon ${green("ok")}`);

// --- [2] Infrastructure (docker compose) ------------------------------------

step("Starting infrastructure (docker compose)");

// `--wait` blocks on healthchecks but treats ANY exited container as a
// failure — even exit 0 — so the one-shot minio-init service is excluded
// here and run separately below (same pattern as the CI smoke job).
run(
  "docker",
  [
    "compose",
    "-f",
    composeFile,
    "up",
    "-d",
    "--wait",
    "postgres",
    "redis",
    "centrifugo",
    "minio",
    "mailpit",
  ],
  {
    hint: "Port already in use? Override host ports in the gitignored docker/.env (see docker/compose.yaml).",
  },
);

// One-shot bucket creation; `mc mb --ignore-existing` makes it idempotent.
run("docker", ["compose", "-f", composeFile, "run", "--rm", "minio-init"]);

// --- [3] Dependencies --------------------------------------------------------

step("Installing dependencies (pnpm install — no-op when up to date)");
run("pnpm", ["install"]);

// --- [4] Build the api graph --------------------------------------------------

step("Building the api dependency graph (turbo-cached)");
run("pnpm", ["turbo", "run", "build", "--filter=api..."]);

// --- [5] Migrations -----------------------------------------------------------

step("Running database migrations (idempotent — applied migrations are skipped)");
run("pnpm", ["--filter", "api", "migrate"], {
  hint: "Connection refused? If docker/.env overrides POSTGRES_HOST_PORT, apps/api/.env.local must set a matching DATABASE_URL.",
});

// --- [6] Seed the golden corpus -----------------------------------------------

step("Seeding the golden corpus (idempotent — already-published data is skipped)");
run("pnpm", ["--filter", "api", "seed"], {
  hint: "Seed publishes catalog/release/price-table fixtures via the publish services. Safe to re-run.",
});

// --- Done ---------------------------------------------------------------------

// Host ports for the summary: compose reads docker/.env (gitignored,
// machine-local overrides) — mirror that here so the printed URLs are real.
const dockerEnv = {};
const dockerEnvPath = path.join(repoRoot, "docker", ".env");
if (existsSync(dockerEnvPath)) {
  for (const line of readFileSync(dockerEnvPath, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(\S+)/.exec(line);
    if (m) dockerEnv[m[1]] = m[2];
  }
}
const pgPort = dockerEnv.POSTGRES_HOST_PORT ?? "5432";
const redisPort = dockerEnv.REDIS_HOST_PORT ?? "6379";

console.log(`\n${green(bold("✔ Setup complete."))} Next steps:

  ${bold("pnpm dev")}                          dev servers (web :3000, api :4000, mobile)
  pnpm --filter api start:worker    the queue/outbox worker (separate process)

  Infra (compose${Object.keys(dockerEnv).length > 0 ? ", ports overridden by docker/.env" : ""}):
    postgres   localhost:${pgPort}        (app/app, db "app")
    redis      localhost:${redisPort}
    Mailpit    http://localhost:8025  (dev email inbox)
    MinIO      http://localhost:9001  (console — minio / minio-dev-password)
    Centrifugo http://localhost:8000

  Once the api is running:
    health     http://localhost:4000/health/ready
    OpenAPI    http://localhost:4000/openapi.json
    bull-board http://localhost:4000/admin/queues  (admin/admin, non-prod only)

  Env: dev defaults need NO env files; see apps/{api,web,mobile}/.env.example
  for overrides. New here? Read CLAUDE.md.`);
