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
 * - handler failure: the claim is DELETEd — the handler threw and a
 *   `@Transactional()` route rolled back, so a retry with the same key may run
 *   again (only successes are memoized). A post-commit STORE failure is the
 *   exception: the claim is RETAINED (the write is already durable; releasing it
 *   would let a retry duplicate a resource/window that has no uniqueness
 *   backstop) — the retry then replays-or-409s instead.
 * - concurrent duplicate while the winner is in flight → 409
 *   `{ code: "idempotency_in_flight" }` (clients back off and retry).
 *
 * The stored record also fingerprints the request BODY (sha256 of canonical
 * JSON): a retry MUST carry the same body to replay — a same-key/different-body
 * call is rejected (`idempotency_key_reused`), so a key can never alias an
 * unrelated request or skip a body-dependent authorization check on the replay
 * path.
 */
import { createHash } from "node:crypto";
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
  /**
   * sha256 of the canonical request body — binds the key to its payload so a
   * same-key/different-body call is rejected instead of silently replayed.
   */
  bodyHash?: string;
}

/** Canonical (recursively key-sorted) JSON so equal payloads hash equal regardless of key order. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = canonicalize((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

function hashBody(body: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(body ?? null)))
    .digest("hex");
}

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

    const bodyHash = hashBody(request.body);
    const claimed = await this.redis.set(
      redisKey,
      JSON.stringify({ pending: true, bodyHash } satisfies StoredRecord),
      "EX",
      TTL_SECONDS,
      "NX",
    );
    // Replay short-circuits the handler — authorization that depends on the
    // request body is enforced by the body-hash check in `replay()`; any other
    // authorization for @Idempotent routes must live in a GUARD (runs before
    // this interceptor), never in the handler. See the authorization invariant
    // on `@Idempotent()`.
    if (claimed !== "OK") return this.replay(redisKey, context, bodyHash);

    const reply = context.switchToHttp().getResponse<FastifyReply>();
    return next.handle().pipe(
      // The HANDLER threw (validation / conflict / DB error): a `@Transactional()`
      // route rolled back, so nothing durable was committed that a retry would
      // duplicate — RELEASE the claim so the client may retry the same key. This
      // `catchError` sits BEFORE the store below so it only ever sees handler
      // errors, never a store error (an error notification passes THROUGH the
      // downstream `mergeMap` untouched).
      catchError((error: unknown) =>
        from(this.redis.del(redisKey)).pipe(mergeMap(() => throwError(() => error))),
      ),
      // The handler SUCCEEDED — for a `@Transactional()` route the DB COMMIT
      // already happened inside `next.handle()`. Store the success record.
      // mergeMap (not tap): the response only goes out once the record is stored,
      // so a client can't observe success then miss the replay.
      //
      // If THIS `set` rejects (Redis blip / eviction) the error propagates with
      // NO `catchError` downstream, so the claim is DELIBERATELY left in place:
      // the write is durable, and releasing it would let a same-key retry
      // re-execute and create a DUPLICATE (resource / window creates have no
      // uniqueness backstop; only bookings are caught by the EXCLUDE → 409). With
      // the pending claim retained, the retry hits `replay()` → 409 (or a replay
      // once a later store wins), never a duplicate.
      mergeMap((body: unknown) =>
        from(
          this.redis.set(
            redisKey,
            JSON.stringify({
              status: reply.statusCode,
              body: body ?? null,
              bodyHash,
            } satisfies StoredRecord),
            "EX",
            TTL_SECONDS,
            // XX: only overwrite our own pending claim; if the claim expired
            // mid-request, do not resurrect the key with a fresh TTL.
            "XX",
          ),
        ).pipe(mergeMap(() => of(body))),
      ),
    );
  }

  private async replay(
    redisKey: string,
    context: ExecutionContext,
    bodyHash: string,
  ): Promise<Observable<unknown>> {
    const raw = await this.redis.get(redisKey);
    const record = parseRecord(raw);

    // Same key, DIFFERENT body = the client reused a key for an unrelated
    // request. Reject it: never replay the original (cross-request aliasing) and
    // never let a body-dependent authz check be skipped on the replay path.
    if (record && record.bodyHash !== undefined && record.bodyHash !== bodyHash) {
      throw new ConflictException({
        message: "This Idempotency-Key was already used with a different request body",
        code: "idempotency_key_reused",
      });
    }

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
