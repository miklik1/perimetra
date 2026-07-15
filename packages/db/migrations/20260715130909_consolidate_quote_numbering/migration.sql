-- O2-a numbering consolidation (ADR 0112 §3): fold the legacy per-org/per-year
-- quote counter into the generalized `document_number_sequence` under the
-- 'quote' series, so all three document classes (quote/order/invoice) share ONE
-- gap-free allocator and one continuity story for the accountant.
--
-- Data-only EXPAND step: copy every legacy counter across, preserving its
-- last_number and timestamps. `ON CONFLICT DO NOTHING` makes this idempotent and
-- never regresses a 'quote' counter the switched code may have already advanced
-- (at real release-phase migration time the target has no 'quote' rows yet, so
-- there is nothing to conflict — the guard is re-run safety). The legacy
-- `quote_number_sequence` table is intentionally LEFT IN PLACE (its contract
-- drop is a later migration once no code reads it, per the ADR).
INSERT INTO "document_number_sequence" ("organization_id", "series", "year", "last_number", "created_at", "updated_at")
SELECT "organization_id", 'quote', "year", "last_number", "created_at", "updated_at"
FROM "quote_number_sequence"
ON CONFLICT DO NOTHING;
