-- Immutable-store guard (ADR 0100, CAR-31): the I3 contract — a published
-- release/catalog/price-table body never changes in place — becomes STRUCTURAL
-- (a DB trigger), not a service-layer convention. Lifecycle metadata stays
-- mutable (release.status for retire, release.initial_input as publish
-- metadata, price_table effective window + margin floor); the DERIVATION
-- INPUTS a quote stamps are frozen at the row.
--
-- Value-based (IS DISTINCT FROM), not `UPDATE OF` column lists: a no-op
-- `SET body = body` passes, any actual change raises. DELETE stays governed
-- by the existing FK RESTRICTs (quotes/projects) + the dev-only seed-reset.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION forbid_immutable_release_update() RETURNS trigger AS $$
BEGIN
  IF NEW.release_id IS DISTINCT FROM OLD.release_id
     OR NEW.model_id IS DISTINCT FROM OLD.model_id
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.catalog_version IS DISTINCT FROM OLD.catalog_version
     OR NEW.body IS DISTINCT FROM OLD.body
  THEN
    RAISE EXCEPTION 'release % is immutable (I3): identity/body/catalog_version never change in place — publish a new version instead (ADR 0100)', OLD.release_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION forbid_immutable_catalog_update() RETURNS trigger AS $$
BEGIN
  IF NEW.version IS DISTINCT FROM OLD.version
     OR NEW.body IS DISTINCT FROM OLD.body
  THEN
    RAISE EXCEPTION 'catalog@% is immutable (I3): version/body never change in place — publish a new version instead (ADR 0100)', OLD.version;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Frozen: what verifyReproducibility re-derives against — the (org, version)
-- lookup identity + currency/VAT/rounding + price/cost bodies. Mutable:
-- effective window (resolveActive lifecycle), margin_floor_pct (a floor
-- GUARD, not a derivation input), owner_id (creator audit ref; erasure
-- anonymizes the user row rather than re-pointing, but the ref is not I3).
CREATE OR REPLACE FUNCTION forbid_immutable_price_table_update() RETURNS trigger AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.dph_rate IS DISTINCT FROM OLD.dph_rate
     OR NEW.rounding_policy IS DISTINCT FROM OLD.rounding_policy
     OR NEW."table" IS DISTINCT FROM OLD."table"
     OR NEW.cost IS DISTINCT FROM OLD.cost
  THEN
    RAISE EXCEPTION 'price_table v% is immutable (I3): org/version/rates/bodies never change in place — publish a new version instead (ADR 0100)', OLD.version;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- DROP-then-CREATE keeps the whole file re-runnable (manual recovery after a
-- partial failure), matching the CREATE OR REPLACE FUNCTION statements above.
DROP TRIGGER IF EXISTS release_immutable_guard ON "release";
CREATE TRIGGER release_immutable_guard
  BEFORE UPDATE ON "release"
  FOR EACH ROW EXECUTE FUNCTION forbid_immutable_release_update();

DROP TRIGGER IF EXISTS catalog_version_immutable_guard ON "catalog_version";
CREATE TRIGGER catalog_version_immutable_guard
  BEFORE UPDATE ON "catalog_version"
  FOR EACH ROW EXECUTE FUNCTION forbid_immutable_catalog_update();

DROP TRIGGER IF EXISTS price_table_immutable_guard ON "price_table";
CREATE TRIGGER price_table_immutable_guard
  BEFORE UPDATE ON "price_table"
  FOR EACH ROW EXECUTE FUNCTION forbid_immutable_price_table_update();
