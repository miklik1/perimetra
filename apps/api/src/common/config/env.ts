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
  /** Strict tier for the raw /api/auth/* routes (per IP). */
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),

  // ---- commercial guards (ADR 0056) -------------------------------------
  /**
   * Minimum acceptable quote margin, percent. `issue` blocks (422) below it
   * unless an admin overrides (audited). A single org-wide constant for now —
   * a per-org floor + a real cost-based margin land with the cost-model slice;
   * default 0 = guard inert (no value-add proxy ever falls below 0%).
   */
  QUOTE_MARGIN_FLOOR_PCT: z.coerce.number().min(0).max(100).default(0),

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

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment:\n${issues}`);
  }
  return parsed.data;
}
