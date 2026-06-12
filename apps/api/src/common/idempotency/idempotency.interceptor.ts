/**
 * Idempotency-Key semantics (spec §8): unsafe requests on `@Idempotent()`
 * routes that carry an `Idempotency-Key` header are executed AT MOST ONCE per
 * `(user, method, path, key)` scope for 24h.
 *
 * Protocol (single Redis key, three states):
 * - claim: `SET key <pending> NX EX 86400` — winner runs the handler.
 * - success: the stored value becomes `{ status, body }` (`XX` so an expired
 *   claim is never resurrected); replays return it verbatim with
 *   `Idempotency-Replayed: true`.
 * - failure: the claim is DELETEd — a retry with the same key may run again
 *   (only successes are memoized).
 * - concurrent duplicate while the winner is in flight → 409
 *   `{ code: "idempotency_in_flight" }` (clients back off and retry).
 */
import {
  ConflictException,
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { type FastifyReply, type FastifyRequest } from "fastify";
import { type Redis } from "ioredis";
import { catchError, from, mergeMap, of, throwError, type Observable } from "rxjs";

import { IDEMPOTENCY_REDIS } from "./idempotency.tokens.js";
import { IDEMPOTENT_METADATA_KEY } from "./idempotent.decorator.js";

/** 24h — the window in which a retried key replays instead of re-executing. */
const TTL_SECONDS = 24 * 60 * 60;

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Structural slice of `SessionRequest` (modules/auth/session.guard.ts) —
 * declared locally so `common/` keeps no import edge into `modules/`.
 */
interface IdempotentRequest extends FastifyRequest {
  sessionContext?: { user: { id: string } };
}

interface StoredRecord {
  pending?: true;
  status?: number;
  body?: unknown;
}

const PENDING = JSON.stringify({ pending: true } satisfies StoredRecord);

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    @Inject(IDEMPOTENCY_REDIS) private readonly redis: Redis,
    private readonly reflector: Reflector,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (context.getType() !== "http") return next.handle();

    const idempotent = this.reflector.getAllAndOverride<boolean>(IDEMPOTENT_METADATA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!idempotent) return next.handle();

    const request = context.switchToHttp().getRequest<IdempotentRequest>();
    if (!UNSAFE_METHODS.has(request.method)) return next.handle();

    const header = request.headers["idempotency-key"];
    const idempotencyKey = Array.isArray(header) ? header[0] : header;
    // The header is optional — without it the request is plain at-least-once.
    if (!idempotencyKey) return next.handle();

    // Scope is per user (SessionGuard ran before interceptors). A route that
    // is @Idempotent() but unguarded has no scope — pass through rather than
    // letting anonymous callers share (and poison) one keyspace.
    const userId = request.sessionContext?.user.id;
    if (!userId) return next.handle();

    const path = request.url.split("?")[0] ?? request.url;
    const redisKey = `idempotency:${userId}:${request.method}:${path}:${idempotencyKey}`;

    const claimed = await this.redis.set(redisKey, PENDING, "EX", TTL_SECONDS, "NX");
    if (claimed !== "OK") return this.replay(redisKey, context);

    const reply = context.switchToHttp().getResponse<FastifyReply>();
    return next.handle().pipe(
      // mergeMap (not tap): the response only goes out once the record is
      // stored — a client can't observe success then miss the replay.
      mergeMap((body: unknown) =>
        from(
          this.redis.set(
            redisKey,
            JSON.stringify({ status: reply.statusCode, body: body ?? null } satisfies StoredRecord),
            "EX",
            TTL_SECONDS,
            // XX: only overwrite our own pending claim; if the claim expired
            // mid-request, do not resurrect the key with a fresh TTL.
            "XX",
          ),
        ).pipe(mergeMap(() => of(body))),
      ),
      // On failure release the claim so the client may retry the same key.
      catchError((error: unknown) =>
        from(this.redis.del(redisKey)).pipe(mergeMap(() => throwError(() => error))),
      ),
    );
  }

  private async replay(redisKey: string, context: ExecutionContext): Promise<Observable<unknown>> {
    const raw = await this.redis.get(redisKey);
    const record = parseRecord(raw);

    // `pending` = the winner is still in flight. `null` (key vanished between
    // our failed claim and this GET — winner failed/expired) is treated the
    // same: 409 tells the client to retry, and the retry will claim cleanly.
    if (!record || record.pending) {
      throw new ConflictException({
        message: "A request with this Idempotency-Key is already in flight",
        code: "idempotency_in_flight",
      });
    }

    const reply = context.switchToHttp().getResponse<FastifyReply>();
    void reply.header("Idempotency-Replayed", "true");
    void reply.status(record.status ?? 200);
    return of(record.body ?? null);
  }
}

function parseRecord(raw: string | null): StoredRecord | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredRecord;
  } catch {
    return null;
  }
}
