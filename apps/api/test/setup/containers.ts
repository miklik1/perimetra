/**
 * Vitest globalSetup for the integration suite (spec §14): ONE Postgres 17
 * and ONE Redis 7 Testcontainer for the WHOLE run (containers are heavy;
 * per-file containers would multiply minutes), plus a tiny in-process SMTP
 * sink so Better Auth's signup verification email needs no Mailpit.
 *
 * Order matters:
 * 1. start containers (parallel),
 * 2. apply the FULL migration chain from `packages/db/migrations` against
 *    the fresh Postgres (the same drizzle migrator + `@repo/db/
 *    migrations-path` the release-phase `migrate.ts` uses) — a chain that
 *    does not apply cleanly on an empty PG 17 kills the run right here,
 *    which is the first half of the spec §6 migration gate,
 * 3. export DATABASE_URL / REDIS_URL (+ SMTP_*) via `process.env`.
 *
 * Env propagation: globalSetup runs in the main vitest process; worker
 * processes fork AFTER it resolves, so these `process.env` writes are
 * visible to every test file (the app's `loadEnv()` reads them at boot).
 *
 * CI needs a Docker daemon and nothing else — no compose stack, no port
 * overrides (Testcontainers maps random host ports, so this never collides
 * with a local docker/compose.yaml stack or CI service containers).
 */
import { createServer, type Server, type Socket } from "node:net";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

import { migrationsFolder } from "@repo/db/migrations-path";

const POSTGRES_IMAGE = "postgres:17-alpine";
const REDIS_IMAGE = "redis:7-alpine";

interface SmtpSink {
  port: number;
  close(): Promise<void>;
}

let postgres: StartedPostgreSqlContainer | undefined;
let redis: StartedRedisContainer | undefined;
let smtp: SmtpSink | undefined;

export async function setup(): Promise<void> {
  [postgres, redis, smtp] = await Promise.all([
    new PostgreSqlContainer(POSTGRES_IMAGE).start(),
    new RedisContainer(REDIS_IMAGE).start(),
    startSmtpSink(),
  ]);

  // Full chain on the fresh container — exactly what release-phase
  // `migrate.ts` does (drizzle migrator + @repo/db/migrations-path).
  const pool = new Pool({ connectionString: postgres.getConnectionUri(), max: 1 });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder });
  } finally {
    await pool.end();
  }

  process.env.DATABASE_URL = postgres.getConnectionUri();
  process.env.REDIS_URL = redis.getConnectionUrl();
  process.env.SMTP_HOST = "127.0.0.1";
  process.env.SMTP_PORT = String(smtp.port);
  // Keep boots quiet and deterministic; ??= so a debugging developer can
  // override from the shell (LOG_LEVEL=debug pnpm test:integration).
  // eslint-disable-next-line turbo/no-undeclared-env-vars -- test-run-local override knob, not a turbo task input (declare in turbo.json if test:integration ever becomes cache-sensitive to it)
  process.env.LOG_LEVEL ??= "warn";
  // Rate limiting is neutralized at the guard (createApiApp overrides
  // ThrottlerGuard) — a global THROTTLE_LIMIT raise can't touch a per-route
  // `@Throttle`, so the env knob is deliberately NOT set here.
  process.env.WEB_ORIGIN ??= "http://localhost:3000";
}

export async function teardown(): Promise<void> {
  await Promise.all([postgres?.stop(), redis?.stop(), smtp?.close()]);
}

/**
 * Minimal RFC 5321 responder on an ephemeral localhost port: accepts every
 * command with 250, answers DATA with 354 and swallows the message. Better
 * Auth sends a verification email on EVERY signup (auth.instance.ts
 * `sendOnSignUp: true`) and a delivery failure fails the signup request —
 * this sink makes the suite hermetic (no Mailpit container, no CI service).
 */
function startSmtpSink(): Promise<SmtpSink> {
  const sockets = new Set<Socket>();

  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));

    let buffer = "";
    let inData = false;
    socket.write("220 itest.local SMTP sink\r\n");

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      for (;;) {
        if (inData) {
          // Message body ends with CRLF.CRLF (or is the bare terminator).
          if (buffer.startsWith(".\r\n")) {
            buffer = buffer.slice(3);
          } else {
            const end = buffer.indexOf("\r\n.\r\n");
            if (end === -1) return; // wait for more body
            buffer = buffer.slice(end + 5);
          }
          inData = false;
          socket.write("250 OK message accepted\r\n");
          continue;
        }
        const eol = buffer.indexOf("\r\n");
        if (eol === -1) return; // wait for a full command line
        const line = buffer.slice(0, eol);
        buffer = buffer.slice(eol + 2);
        const verb = (line.split(" ")[0] ?? "").toUpperCase();
        if (verb === "DATA") {
          inData = true;
          socket.write("354 end data with <CRLF>.<CRLF>\r\n");
        } else if (verb === "QUIT") {
          socket.write("221 bye\r\n");
          socket.end();
          return;
        } else {
          // EHLO/HELO/MAIL/RCPT/RSET/NOOP — accept everything.
          socket.write("250 OK\r\n");
        }
      }
    });
  });

  return new Promise((resolve, reject) => {
    // No 'error' listener on purpose: binding port 0 on loopback cannot
    // realistically fail, and an unhandled 'error' event would crash the
    // setup loudly — which is the right failure mode here.
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("SMTP sink failed to bind a port"));
        return;
      }
      resolve({
        port: address.port,
        close: () =>
          new Promise<void>((res, rej) => {
            for (const socket of sockets) socket.destroy();
            server.close((error) => (error ? rej(error) : res()));
          }),
      });
    });
  });
}
