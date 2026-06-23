/**
 * Typed, fail-fast environment (the `@repo/config` philosophy applied to the
 * api). Parsed ONCE at boot — an invalid env crashes the process before it
 * accepts traffic, never at first use.
 */
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default("0.0.0.0"),
  /** Dev default matches docker/compose.yaml; prod MUST set it. */
  DATABASE_URL: z.string().min(1).default("postgres://app:app@localhost:5432/app"),
  /** Per-instance pool size — keep small (ADR 0038 pooling doctrine). */
  DATABASE_POOL_SIZE: z.coerce.number().int().positive().default(10),
  /**
   * Behind the Next.js proxy / a load balancer this must be on so
   * rate-limiting and logs see real client IPs. Off by default (direct dev).
   */
  TRUST_PROXY: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  /** Fastify body limit — 1MB default (ADR 0044 security baseline). */
  BODY_LIMIT_BYTES: z.coerce.number().int().positive().default(1_048_576),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  /** Better Auth signing/encryption secret (ADR 0033). Dev placeholder only — prod MUST set a generated one. */
  BETTER_AUTH_SECRET: z.string().min(1).default("dev-secret-change-me"),
  /** Public base URL of this api — Better Auth derives callback/redirect URLs from it. */
  BETTER_AUTH_URL: z.url().default("http://localhost:4000"),
  /** Web app origin — Better Auth trusted origin (its origin/CSRF check on /api/auth/*). */
  WEB_ORIGIN: z.url().default("http://localhost:3000"),
  /** Dev default matches docker/compose.yaml. Session secondary storage (and BullMQ queues, ADR 0043). */
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),

  // ---- jobs / outbox (ADR 0037/0043) ----------------------------------
  /** Outbox relay poll interval. 500ms is the latency/load sweet spot (ADR 0037 — no LISTEN/NOTIFY). */
  OUTBOX_RELAY_INTERVAL_MS: z.coerce.number().int().positive().default(500),
  /** bull-board basic-auth credentials (non-production only; the board never mounts in prod). */
  BULL_BOARD_USER: z.string().min(1).default("admin"),
  BULL_BOARD_PASSWORD: z.string().min(1).default("admin"),

  // ---- email (spec §7.4) — dev defaults match Mailpit in compose -------
  SMTP_HOST: z.string().min(1).default("localhost"),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  EMAIL_FROM: z.string().min(1).default("Skeleton <no-reply@localhost>"),

  // ---- storage (spec §7.5) — dev defaults match MinIO in compose -------
  /** Must be the BROWSER-reachable host — presigned URLs embed it. */
  S3_ENDPOINT: z.url().default("http://localhost:9000"),
  S3_REGION: z.string().min(1).default("us-east-1"),
  S3_ACCESS_KEY: z.string().min(1).default("minio"),
  S3_SECRET_KEY: z.string().min(1).default("minio-dev-password"),
  S3_BUCKET: z.string().min(1).default("app"),

  // ---- realtime (spec §7.3) — dev defaults match Centrifugo in compose -
  CENTRIFUGO_URL: z.url().default("http://localhost:8000"),
  CENTRIFUGO_API_KEY: z.string().min(1).default("dev-centrifugo-api-key"),
  /** Must equal centrifugo's client.token.hmac_secret_key. */
  CENTRIFUGO_TOKEN_SECRET: z.string().min(1).default("dev-centrifugo-token-secret"),

  // ---- throttling (ADR 0044 baseline) -----------------------------------
  /** Default tier for Nest controller routes (per user-or-ip). */
  THROTTLE_TTL_MS: z.coerce.number().int().positive().default(60_000),
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(100),
  /** Strict tier for the credential POSTs on /api/auth/* (per IP). */
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  /** Generous tier for the high-frequency GET /api/auth/get-session READ (per
   * IP) — the Better Auth web client polls it on every window-focus and
   * AuthGuard mount, so the strict tier trips into a spurious logout. ADR 0044. */
  AUTH_SESSION_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),

  // The quote margin floor is per-org (ADR 0059): read from the active price
  // table's `marginFloorPct` at issue, no longer an env-backed constant.

  /**
   * Platform/vendor operator designation (ADR 0062). When set, the seed promotes
   * this user (by email) to Better Auth `user.role='admin'` — the operator who
   * publishes releases/catalog and assigns them to tenant orgs. Unset = no
   * auto-promotion (promote manually, or in tests). Authoring is vendor-only
   * (CORE_SPEC §3); this is how the vendor is named in a deployment.
   */
  PLATFORM_ADMIN_EMAIL: z.string().optional(),

  /**
   * Default release set auto-assigned to every genuinely-new org at provision
   * time (ADR 0063) — a comma-separated list of release ids (e.g.
   * `sliding-gate@1,fence-run@1`). Keeps new-tenant visibility VENDOR-controlled
   * per CORE_SPEC §3 (the vendor decides the starter set) while automating
   * onboarding, rather than leaking every published release to every future org.
   * Empty/unset = no default assignment (a fresh org starts empty — the ADR 0062
   * default). Ids that aren't published yet are skipped fail-soft at provision
   * time. Note: the seed assigns the golden corpus to EXISTING orgs; set this so
   * orgs created AFTER the seed (fresh signups) also get a starter set.
   */
  PLATFORM_DEFAULT_RELEASE_IDS: z
    .string()
    .default("")
    .transform((v) =>
      // Split on comma OR any whitespace, so a multi-line Docker secret can't
      // smuggle a newline INTO an id (which would 404 every signup fail-soft).
      v
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),

  // ---- observability & analytics (ADR 0036) — all opt-in ---------------
  /** Errors-only Sentry (traces belong to OTel). Unset = disabled. Read pre-DI by sentry/init.ts. */
  SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  /** Server-side PostHog capture + flags. Unset = no-op. EU host default. */
  POSTHOG_API_KEY: z.string().optional(),
  POSTHOG_HOST: z.url().default("https://eu.i.posthog.com"),
  /** Personal API key + project id: local flag evaluation AND GDPR person deletion (purge hook). */
  POSTHOG_PERSONAL_API_KEY: z.string().optional(),
  POSTHOG_PROJECT_ID: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export const ENV = Symbol("ENV");

/**
 * Secrets that ship with a dev placeholder default so `pnpm dev` runs with no
 * `.env` — but a forgotten env var in production then boots green on a
 * publicly-known value. For a signing/admin key (the auth secret, the realtime
 * token + api key, the bull-board password) that is a forgeable-credential
 * trap, so production MUST override them.
 */
const PRODUCTION_FORBIDDEN_DEFAULTS: Readonly<Record<string, string>> = {
  BETTER_AUTH_SECRET: "dev-secret-change-me",
  CENTRIFUGO_API_KEY: "dev-centrifugo-api-key",
  CENTRIFUGO_TOKEN_SECRET: "dev-centrifugo-token-secret",
  BULL_BOARD_PASSWORD: "admin",
};

/** Signing secrets that must additionally meet a minimum entropy in production. */
const PRODUCTION_MIN_SECRET_LENGTH: Readonly<Record<string, number>> = {
  BETTER_AUTH_SECRET: 32,
  CENTRIFUGO_TOKEN_SECRET: 32,
};

/**
 * Fail-fast at boot (the release phase, never at first use) if production still
 * runs on a dev placeholder secret or a too-short signing key — a single
 * forgotten env var must crash the process, not silently ship a forgeable key.
 */
function assertProductionSecrets(env: Env): void {
  if (env.NODE_ENV !== "production") return;
  const read = (key: string): unknown => (env as unknown as Record<string, unknown>)[key];
  const issues: string[] = [];
  for (const [key, placeholder] of Object.entries(PRODUCTION_FORBIDDEN_DEFAULTS)) {
    if (read(key) === placeholder) {
      issues.push(`  ${key}: still the dev placeholder — set a generated value in production`);
    }
  }
  for (const [key, min] of Object.entries(PRODUCTION_MIN_SECRET_LENGTH)) {
    const value = read(key);
    if (typeof value === "string" && value.length < min) {
      issues.push(`  ${key}: must be at least ${min} characters in production`);
    }
  }
  if (issues.length > 0) {
    throw new Error(`Insecure production environment:\n${issues.join("\n")}`);
  }
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment:\n${issues}`);
  }
  assertProductionSecrets(parsed.data);
  return parsed.data;
}
