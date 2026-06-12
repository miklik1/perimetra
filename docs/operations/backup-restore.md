# Backup, restore & disaster recovery

What holds state, what gets backed up, and how a restore actually runs.
Companion runbooks: [deploy.md](deploy.md), [incident.md](incident.md).

## Recovery objectives (TEMPLATE defaults — override per project)

| Objective                          | Default | Meaning                                    |
| ---------------------------------- | ------- | ------------------------------------------ |
| **RPO** (max acceptable data loss) | **24h** | daily backups are the floor; PITR beats it |
| **RTO** (max acceptable downtime)  | **4h**  | restore + redeploy + verify, end to end    |

These are skeleton defaults so a derived project never ships with _no_ stated
objective. Every real project must restate them in its own copy of this file
(a client SLA of RPO 5min/RTO 30min implies managed PITR + standby — a
different budget than the defaults assume).

## What holds state

| Store          | Holds                                                             | Backup posture                          |
| -------------- | ----------------------------------------------------------------- | --------------------------------------- |
| **Postgres**   | everything durable: domain data, auth/sessions, outbox, audit log | **the** backup target (PITR/pgBackRest) |
| **S3 / MinIO** | uploaded objects, privacy-export bundles                          | versioning + lifecycle (below)          |
| **Redis**      | BullMQ queues, session cache, throttle counters, idempotency keys | **none — ephemeral by doctrine**        |
| **Centrifugo** | nothing durable (in-memory history only)                          | none; redeploy                          |

## The doctrine: Redis is ephemeral

**Anything durable goes through the outbox; Redis is rebuildable.** This is a
design invariant (ADR 0037/0043), not an aspiration, and two rules make it
true:

1. **Every domain event is written to the Postgres `outbox` table** in the
   same transaction as the state change (`OutboxService.emit()` only accepts
   the ambient transactional client). BullMQ is a _delivery_ mechanism, not a
   system of record.
2. **Job payloads carry IDs, never data** (ADR 0043) — processors re-fetch
   from Postgres. So Redis holds no PII and no business state worth saving.

**Consequence — losing Redis is a non-event, not a disaster:**

- Unpublished outbox rows (`status = 'pending'`) re-relay automatically the
  moment a worker sees the new Redis.
- Repeatable jobs (cron) re-register themselves: every processor upserts its
  schedulers in `onApplicationBootstrap`, so a fresh Redis self-schedules on
  the next worker boot.
- Sessions: Better Auth's primary store is Postgres; Redis is secondary
  storage (a lookup cache). Users stay logged in.
- Throttle counters and idempotency-key cache reset — briefly weaker abuse
  protection and replay protection, nothing lost.

**The one known gap:** outbox rows already marked `published` whose jobs were
still sitting in Redis (queued or retrying) die with it. Recovery: re-relay
the window — consumers are written for at-least-once delivery, so replays are
safe:

```sql
-- Re-publish everything relayed since shortly before the Redis loss:
UPDATE outbox
SET status = 'pending', published_at = NULL, attempts = 0
WHERE status = 'published'
  AND published_at > now() - interval '1 hour';  -- size to the incident
```

Because of this doctrine, **Redis runs without persistence requirements**.
The only hard Redis config rule is `maxmemory-policy noeviction` (BullMQ
corrupts if job keys are evicted — the dev compose sets it; verify it on any
managed Redis).

## Postgres

### Preferred: managed Postgres with PITR

If the project runs on managed Postgres (Railway/Neon/RDS/Cloud SQL/managed
Hetzner), use the provider's point-in-time recovery and don't build backup
machinery. Verify, per project, that:

- [ ] PITR / WAL archiving is **enabled** (not just daily snapshots) — this is
      what turns RPO from 24h into minutes.
- [ ] Retention window ≥ 7 days (≥ 30 days if compliance asks).
- [ ] Restores go to a **new instance** (never in-place) and you know the
      provider's actual restore time — that number bounds your RTO.
- [ ] Backups are in a different failure domain than the database itself.

### Self-hosted fallback: pgBackRest (convention sketch)

No pgBackRest config ships in this repo — this is the blessed convention to
implement when a project self-hosts Postgres (e.g. the Hetzner recipe in
[deploy.md](deploy.md)):

- **Repository:** an S3-compatible bucket (separate from the app bucket, in a
  different region/provider than the database host), `repo1-cipher-type=aes-256-cbc`
  (encrypted at rest).
- **WAL archiving:** `archive_command = 'pgbackrest --stanza=app archive-push %p'`
  — this is what gives PITR, not just snapshots.
- **Schedule:** weekly full + daily differential (cron on the DB host),
  `repo1-retention-full=4`.
- **Restore:** `pgbackrest --stanza=app --type=time "--target=<timestamp>" restore`
  to a fresh data directory.
- pg*dump is fine as a \_supplementary* logical export (pre-migration snapshot,
  staging refresh), not as the backup strategy — no PITR, slow restore at size.

### What is deliberately NOT backed up

The `outbox` table and the audit log live in Postgres, so they ride along —
but retention jobs prune them (published outbox rows after 30 days, audit
rows after 2 years; ADR 0040). Backups are not an archive; if a project needs
audit history beyond retention, export it to S3 before the sweep.

## S3 / object storage

Uploaded objects don't live in Postgres, so the bucket needs its own posture.
On the production bucket (any S3-compatible provider; MinIO is dev-only —
its compose volume is not a backup):

- [ ] **Versioning ON** — delete/overwrite becomes recoverable; this is the
      object-store equivalent of PITR.
- [ ] **Lifecycle rules:** expire noncurrent versions after 30 days (template
      default); abort incomplete multipart uploads after 7 days.
- [ ] Cross-region replication only when the project's DR posture demands it
      (template default: versioning is enough).

App-level hygiene already handles orphans: presigned-but-never-confirmed
uploads are deleted by the storage module's cleanup job (ADR 0035), so the
bucket doesn't accrete garbage that backups would faithfully preserve.

**Erasure caveat (GDPR):** versioning keeps "deleted" objects as noncurrent
versions. The privacy module's `eraseUser` deletes the current version; the
30-day noncurrent expiry is what makes erasure eventually true. Don't set
noncurrent retention longer than your erasure story can explain.

## Restore drill (run it, don't assume it)

A backup that has never been restored is a hypothesis. Quarterly (template
default — at minimum before go-live and after any infra change):

1. Restore the latest backup / a PITR point to a **scratch instance**.
2. Sanity-check the data: row counts on the top tables, newest `created_at`
   per table vs. the restore point, `SELECT count(*) FROM outbox WHERE status = 'pending'`.
3. Point a locally-run api at it (`DATABASE_URL=<scratch> pnpm --filter api start`)
   and hit `/health/ready` + log in + list the reference resource.
4. Time the whole thing. **If wall-clock > RTO, the drill failed** even though
   the restore worked — fix the procedure or the RTO.
5. Record date, backup used, duration, issues — in the project's ops log.
6. Tear the scratch instance down.

## Full-DR order of operations

Region/provider gone, rebuilding from backups:

1. Provision Postgres; restore (PITR/pgBackRest) to the latest point.
2. Provision Redis (empty — doctrine above; just set `noeviction`).
3. Deploy per [deploy.md](deploy.md): `migrate` (no-ops if the restore is
   current, applies the tail if the image is newer) → api + worker + Centrifugo → web.
4. Re-relay the incident window (the `UPDATE outbox …` above) so events that
   died in Redis are redelivered.
5. Verify golden signals ([incident.md](incident.md)): outbox lag draining,
   queues consuming, pool healthy.
6. Secrets come from the platform's env config (12-factor — there is no
   secrets store in the stack to restore separately, but the env values must
   be recoverable: keep them in the team password manager, not only in the
   dead platform).
