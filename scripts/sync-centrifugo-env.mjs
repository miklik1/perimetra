#!/usr/bin/env node
/**
 * Fresh-clone self-heal for the Centrifugo secret pair.
 *
 * The problem (vault finding "Gitignored .env.local secret that committed
 * config depends on breaks fresh clones"): create-project rotates the
 * Centrifugo HTTP-API key + HMAC token secret into BOTH the gitignored
 * `apps/api/.env.local` AND the COMMITTED `docker/centrifugo/config.json`.
 * They must match (the api authenticates to Centrifugo with the key and mints
 * client JWTs with the secret). On a fresh `git clone` of an already-stamped
 * repo, `.env.local` is absent, so the api falls back to the env.ts
 * `dev-centrifugo-*` defaults — which no longer match the rotated value still
 * sitting in the committed config.json. Centrifugo returns 401 and realtime
 * silently dies; the app otherwise boots fine.
 *
 * The fix: the COMMITTED config.json is the single source of truth. This step
 * reconstructs the two CENTRIFUGO_* lines in `.env.local` by reading them BACK
 * from config.json whenever they are missing. We never commit the secret and
 * never overwrite a value the developer set by hand (manual rotation is
 * respected — fill missing keys only).
 *
 * Guard: if config.json still holds the `dev-centrifugo-*` DEFAULTS, this is an
 * unstamped skeleton (nothing rotated to reconstruct) and we no-op WITHOUT
 * creating `.env.local` — that keeps create-project's "refuse to overwrite an
 * existing .env.local" preflight intact on a fresh skeleton clone.
 *
 * Wired into `predev` and `scripts/setup.mjs`. Stdlib only (may run before
 * `pnpm install`); idempotent.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.join(repoRoot, "docker", "centrifugo", "config.json");
const apiEnvPath = path.join(repoRoot, "apps", "api", ".env.local");

// These must equal apps/api/src/common/config/env.ts CENTRIFUGO_* defaults.
const DEFAULT_API_KEY = "dev-centrifugo-api-key";
const DEFAULT_TOKEN_SECRET = "dev-centrifugo-token-secret";

if (!existsSync(configPath)) process.exit(0); // no realtime config — nothing to heal.

let config;
try {
  config = JSON.parse(readFileSync(configPath, "utf8"));
} catch {
  process.exit(0); // malformed/partial config — not this script's job to fix.
}

const apiKey = config?.http_api?.key;
const tokenSecret = config?.client?.token?.hmac_secret_key;
if (!apiKey || !tokenSecret) process.exit(0); // realtime not configured in this stamp.

// Unstamped skeleton: the committed defaults already match env.ts — no rotated
// secret to reconstruct. No-op (and leave .env.local absent for create-project).
if (apiKey === DEFAULT_API_KEY && tokenSecret === DEFAULT_TOKEN_SECRET) process.exit(0);

const lines = {
  CENTRIFUGO_API_KEY: apiKey,
  CENTRIFUGO_TOKEN_SECRET: tokenSecret,
};

if (!existsSync(apiEnvPath)) {
  // Fresh clone of a stamped repo: reconstruct the minimal secret set the
  // committed config depends on. Everything else in a stamped .env.local
  // (BETTER_AUTH_SECRET, host-port remap) safely falls back to the env.ts
  // dev defaults on a single fresh clone — only the Centrifugo pair has a
  // committed counterpart it must agree with.
  writeFileSync(
    apiEnvPath,
    `# Reconstructed by \`node scripts/sync-centrifugo-env.mjs\` (fresh-clone self-heal).
# Gitignored. The Centrifugo secret pair below is read BACK from the committed
# docker/centrifugo/config.json so a fresh clone of this stamped repo doesn't
# fall back to mismatched env.ts defaults (silent realtime 401). To regenerate
# the FULL stamped env (auth secret, host-port remap), run:
#   node scripts/create-project --force
CENTRIFUGO_API_KEY=${lines.CENTRIFUGO_API_KEY}
CENTRIFUGO_TOKEN_SECRET=${lines.CENTRIFUGO_TOKEN_SECRET}
`,
  );
  console.log("sync-centrifugo-env: reconstructed apps/api/.env.local from committed config.json");
  process.exit(0);
}

// .env.local exists — fill ONLY the keys it is missing (respect manual rotation).
const existing = readFileSync(apiEnvPath, "utf8");
const missing = Object.entries(lines).filter(
  ([key]) => !new RegExp(`^${key}=`, "m").test(existing),
);
if (missing.length === 0) process.exit(0);

const block = `${existing.endsWith("\n") ? "" : "\n"}# Centrifugo secret pair restored from committed docker/centrifugo/config.json.
${missing.map(([key, value]) => `${key}=${value}`).join("\n")}
`;
appendFileSync(apiEnvPath, block);
console.log(
  `sync-centrifugo-env: restored ${missing.map(([k]) => k).join(", ")} in apps/api/.env.local`,
);
