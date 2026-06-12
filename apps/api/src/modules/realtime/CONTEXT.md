# realtime — Centrifugo bridge (ADR 0035, closes 0029)

The api never holds WebSockets — Centrifugo (v6, compose port 8000) does.
This module issues the JWTs the frontend `@repo/realtime` adapter needs and
publishes server events over Centrifugo's HTTP API.

## Public surface

- `RealtimeService.connectionToken(userId)` /
  `.subscriptionToken(userId, channel)` — HMAC JWTs
  (`CENTRIFUGO_TOKEN_SECRET` must equal Centrifugo's
  `client.token.hmac_secret_key`).
- `RealtimeService.publish(channel, data)` — fire-and-forget HTTP publish
  (returns `false` on failure rather than throwing; realtime is best-effort).
- `userChannel(userId)` / channel-name helpers (`realtime.tokens.ts`) — the
  ONLY way to spell a channel name; authorization derives from the naming
  convention (per-user, per-org channels).
- `realtime.controller.ts` — `/v1/realtime/*` token endpoints (session-
  guarded; subscription endpoint authorizes channel ownership).

## Must never

- Be the source of truth: realtime pushes are projections of outbox events
  (worker handlers call `publish`); clients must survive missed messages.
- Put PII on channels or in payloads — push IDs, let clients re-fetch.
- Import domain module schemas.

Governing ADR: `docs/adr/0035-infra-modules.md` (realtime section).
