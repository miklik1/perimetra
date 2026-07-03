SET lock_timeout = '5s';

-- CAR-20: enforce one membership per (organization_id, user_id). Better
-- Auth's `organization` plugin can race a DUPLICATE `member` row for the
-- same org+user (`acceptInvitation` calls `adapter.createMember`
-- unconditionally with no existing-membership check, and its
-- `updateInvitation` is an unconditional-by-id UPDATE with no
-- `WHERE status = 'pending'` guard — two concurrent accepts of the same or
-- two distinct pending invitations for the same org+user both reach
-- `createMember`). Dedup first so the new UNIQUE INDEX can be created on an
-- already-existing table with pre-existing duplicates.
--
-- Dedup rule (deterministic): for each (organization_id, user_id), KEEP the
-- OLDEST row (ORDER BY created_at, then id as a tiebreaker) and DELETE the
-- rest. Zero-row no-op when no duplicates exist (fresh DBs).
DELETE FROM "member" m
USING (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY organization_id, user_id
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM "member"
) ranked
WHERE m.id = ranked.id
  AND ranked.rn > 1;

CREATE UNIQUE INDEX "member_organizationId_userId_uidx" ON "member" ("organization_id","user_id");
