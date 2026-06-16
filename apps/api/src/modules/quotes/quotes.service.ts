/**
 * Quotes service (ADR 0053) — the I3 core. `issue` runs the SAME pure
 * `deriveSite` the configurator runs (I1/I4), server-side, against the IMMUTABLE
 * stores (releases + catalog + the active price table), then freezes the
 * snapshot and copies the engine `SiteStamps` verbatim. `verifyReproducibility`
 * reloads the exact stamped inputs and re-derives — the snapshot must reproduce
 * byte-for-byte (I3). Money crosses the I10 boundary once, as result strings.
 *
 * The wall clock / share-token randomness live HERE (app-layer), never in the
 * engine — determinism (I1) is preserved.
 */
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { Transactional } from "@nestjs-cls/transactional";
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";

import { type QuoteRow } from "@repo/db/schema/quotes";
import {
  deriveSite,
  type CascadeLayers,
  type CategoryTotals,
  type ConfigInput,
  type CostTable,
  type MoneyTotals,
  type SiteBomLine,
  type SiteInstance,
  type SiteResult,
} from "@repo/engine";
import { type ProductModelRelease, type Site } from "@repo/model";
import {
  buildCutList,
  buildSitePlan,
  buildWorkshopDrawing,
  type CutList,
  type SitePlan,
  type WorkshopDrawing,
} from "@repo/renderers";
import {
  type IssueQuoteInput,
  type ListQuotesQuery,
  type QuoteDetail,
  type QuoteReproduction,
  type QuotesPage,
  type QuoteStamps,
  type QuoteSummary,
} from "@repo/validators/quotes";

import { isPriceBlind, type OrgRole } from "../../common/rbac/org-role.js";
import { type RequestScope } from "../../common/tenancy/request-scope.js";
import { AuditService } from "../audit/audit.service.js";
import { CatalogVersionsService } from "../catalog-versions/catalog-versions.service.js";
import { PriceTablesService } from "../price-tables/price-tables.service.js";
import { ReleasesService } from "../releases/releases.service.js";
import { quoteMarginPct } from "./margin.js";
import { QuotesRepository } from "./quotes.repository.js";

/** The frozen outputs + the minimal re-derivation seed (raw inputs + site). */
interface QuoteSnapshot {
  bom: SiteBomLine[];
  totals: CategoryTotals;
  money: MoneyTotals;
  /** Cost-of-goods totals (ADR 0059) — present only when the stamped price table
   *  carried cost data; frozen so verifyReproducibility re-derives them (I3). */
  costTotals?: CategoryTotals;
  costMoney?: MoneyTotals;
  cutList: CutList;
  drawings: { site: SitePlan; instances: Record<string, WorkshopDrawing> };
  inputs: Record<string, { releaseId: string; input: ConfigInput; overrides?: CascadeLayers }>;
  site: Site;
  cutOptions: { kerfMm: number };
}

/** The frozen artifacts (bom/totals/money/cost/cutList/drawings) off a site result. */
function artifactsOf(result: SiteResult, site: Site, kerfMm: number) {
  return {
    bom: result.bom,
    totals: result.totals,
    money: result.money,
    // Cost is optional — only when the price table carried a cost layer (ADR 0059).
    ...(result.costTotals !== undefined && {
      costTotals: result.costTotals,
      costMoney: result.costMoney,
    }),
    cutList: buildCutList(result, { kerfMm }),
    drawings: {
      site: buildSitePlan(site, result),
      instances: Object.fromEntries(
        Object.entries(result.instances).map(([id, r]) => [id, buildWorkshopDrawing(r)]),
      ),
    },
  };
}

/** Canonical instance order (by instanceId). `deriveSite` produces several
 *  order-sensitive arrays in instance-iteration order (the `bom` array,
 *  `bom[].sources`, `stamps.overrideIds`); sorting the roster the same way at
 *  BOTH issue and re-derivation makes them deterministic regardless of caller
 *  order or Postgres JSONB key ordering — the I3 deep-equal then holds. */
const byInstanceId = (a: { instanceId: string }, b: { instanceId: string }): number =>
  a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0;

/** Project a BOM line to its I3-comparable fields — everything EXCEPT the raw
 *  `totalPrice` float, which the engine documents as internal-only (the I10
 *  money is `totalPriceMoney`). The money string canonicalises to 15 sig digits
 *  and survives JSONB exactly; the raw float need not, so it is not compared. */
function bomForCompare(bom: SiteBomLine[]) {
  return bom.map((l) => ({
    componentCode: l.componentCode,
    name: l.name,
    unit: l.unit,
    category: l.category,
    quantity: l.quantity,
    totalPriceMoney: l.totalPriceMoney,
    sources: l.sources,
  }));
}

/**
 * PRICE-BLIND projection of a frozen snapshot for the `workshop` role (ADR 0056).
 * A WHITELIST, not a blacklist: only the geometry/specs the workshop needs are
 * copied through (bom components/quantities, cut list, drawings, site, inputs),
 * so the money rollups (`money`, `totals`) and every per-line price are dropped —
 * AND a future snapshot field that happens to carry a price can't leak by being
 * forgotten. Stripping happens HERE, server-side, never merely FE-hidden.
 */
function blindSnapshot(snapshot: QuoteSnapshot): Record<string, unknown> {
  return {
    bom: snapshot.bom.map((line) => ({
      componentCode: line.componentCode,
      name: line.name,
      unit: line.unit,
      category: line.category,
      quantity: line.quantity,
      sources: line.sources,
    })),
    cutList: snapshot.cutList,
    drawings: snapshot.drawings,
    inputs: snapshot.inputs,
    site: snapshot.site,
    cutOptions: snapshot.cutOptions,
  };
}

function toSummary(row: QuoteRow, role: OrgRole): QuoteSummary {
  return {
    id: row.id,
    projectId: row.projectId,
    status: row.status,
    currency: row.currency,
    // Workshop is price-blind: the total is nulled server-side (I10 string otherwise).
    total: isPriceBlind(role) ? null : row.totalMoney,
    validUntil: row.validUntil ? row.validUntil.toISOString() : null,
    shareToken: row.shareToken,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toDetail(row: QuoteRow, role: OrgRole): QuoteDetail {
  const snapshot = isPriceBlind(role) ? blindSnapshot(row.snapshot as QuoteSnapshot) : row.snapshot;
  return { ...toSummary(row, role), stamps: row.stamps as QuoteStamps, snapshot };
}

@Injectable()
export class QuotesService {
  constructor(
    private readonly quotes: QuotesRepository,
    private readonly releases: ReleasesService,
    private readonly catalogVersions: CatalogVersionsService,
    private readonly priceTables: PriceTablesService,
    private readonly audit: AuditService,
  ) {}

  async list(scope: RequestScope, role: OrgRole, query: ListQuotesQuery): Promise<QuotesPage> {
    const { items, nextCursor } = await this.quotes.list(scope, query);
    return { items: items.map((row) => toSummary(row, role)), nextCursor };
  }

  async get(scope: RequestScope, role: OrgRole, quoteId: string): Promise<QuoteDetail> {
    const row = await this.quotes.findById(scope, quoteId);
    if (!row) throw new NotFoundException("Quote not found");
    return toDetail(row, role);
  }

  @Transactional()
  async issue(scope: RequestScope, role: OrgRole, input: IssueQuoteInput): Promise<QuoteDetail> {
    const site = input.site as Site;

    // Resolve every instance's release (+ its pinned catalog version) from the
    // immutable store — the stamp handle is the natural key.
    const loaded = await Promise.all(
      input.instances.map(async (i) => {
        const detail = await this.releases.loadByReleaseId(i.releaseId);
        if (!detail) {
          throw new BadRequestException(`release ${i.releaseId} is not published`);
        }
        return { i, detail };
      }),
    );

    // Defense-in-depth (ADR 0062): every roster release must be ASSIGNED to this
    // org. The configurator only offers assigned releases (the `listForOrg`
    // filter); this closes the direct-API seam at issue. 403 `release_not_assigned`
    // on a published-but-unassigned release (an UNpublished one already 400'd
    // above). Re-derivation/verify deliberately does NOT check — a quote on a
    // since-unassigned release must still reproduce byte-identically (I3).
    await this.releases.assertAssigned(
      scope,
      input.instances.map((i) => i.releaseId),
    );

    // A site derives against ONE catalog version (I3 — a single catalog stamp).
    const catalogVersions = [...new Set(loaded.map((l) => l.detail.catalogVersion))];
    if (catalogVersions.length !== 1) {
      throw new UnprocessableEntityException({
        message: "instances reference different catalog versions",
        code: "mixed_catalog",
        catalogVersions,
      });
    }
    const catalogVersion = catalogVersions[0]!;
    const catalog = await this.catalogVersions.loadCatalog(catalogVersion);
    if (!catalog) throw new BadRequestException(`catalog@${catalogVersion} is not published`);

    // The active price table (app-layer clock; the engine stays pure). 404 → no
    // silent empty price layer (I5).
    const priceTable = await this.priceTables.resolveActive(scope);

    // Canonical instance order (I3) — the snapshot's order-sensitive arrays are
    // frozen in this order and re-derivation sorts identically.
    const siteInstances: SiteInstance[] = loaded
      .map(({ i, detail }) => ({
        instanceId: i.instanceId,
        release: detail.body as ProductModelRelease,
        input: i.input as ConfigInput,
        ...(i.overrides !== undefined ? { overrides: i.overrides as CascadeLayers } : {}),
      }))
      .sort(byInstanceId);

    // The cost layer (ADR 0059), co-located on the stamped price table row, so
    // `priceTableVersion` covers it for I3. Absent on pre-cost-model tables.
    const costs = (priceTable.cost ?? undefined) as CostTable | undefined;
    const result = deriveSite(site, siteInstances, priceTable.table as never, catalog, {
      ...(costs !== undefined && { costs }),
    });
    if (!result.isValid) {
      throw new UnprocessableEntityException({
        message: "site did not derive to a valid result",
        code: "site_invalid",
        issues: result.issues,
      });
    }

    // Margin-floor guard (ADR 0056 → ADR 0059): the floor is per-org, read from
    // the active price table; margin is the REAL (price − cost)/price. The guard
    // is a pure read of the derived totals — it never touches derivation, so
    // reproducibility (golden 129891.504) holds. A floor with no cost data is a
    // misconfiguration surfaced, never silently passed (I5).
    const floorPct = priceTable.marginFloorPct !== null ? Number(priceTable.marginFloorPct) : null;
    let marginAudit: { marginPct: number; floorPct: number; reason: string } | undefined;
    if (floorPct !== null) {
      if (result.costTotals === undefined) {
        throw new UnprocessableEntityException({
          message: "a margin floor is set but the active price table has no cost data",
          code: "margin_floor_without_cost",
        });
      }
      const marginPct = quoteMarginPct(result.totals, result.costTotals);
      const override = role === "admin" ? input.marginOverride : undefined;
      if (marginPct < floorPct && !override) {
        throw new UnprocessableEntityException({
          message: "quote margin is below the floor",
          code: "margin_below_floor",
          marginPct,
          floorPct,
        });
      }
      if (marginPct < floorPct && override) {
        marginAudit = { marginPct, floorPct, reason: override.reason };
      }
    }

    const kerfMm = input.kerfMm ?? 0;
    const snapshot: QuoteSnapshot = {
      ...artifactsOf(result, site, kerfMm),
      inputs: Object.fromEntries(
        loaded.map(({ i }) => [
          i.instanceId,
          {
            releaseId: i.releaseId,
            input: i.input as ConfigInput,
            ...(i.overrides !== undefined ? { overrides: i.overrides as CascadeLayers } : {}),
          },
        ]),
      ),
      site,
      cutOptions: { kerfMm },
    };
    const stamps = result.stamps;

    const row = await this.quotes.insert(scope, {
      projectId: input.projectId ?? null,
      status: "issued",
      currency: priceTable.currency,
      shareToken: randomUUID(),
      validUntil: input.validUntil ? new Date(input.validUntil) : null,
      totalMoney: result.money.total,
      catalogVersion: stamps.catalogVersion,
      priceTableVersion: stamps.priceTableVersion,
      stamps,
      snapshot,
    });

    await this.audit.record({
      actorId: scope.userId,
      action: "quote.issue",
      entityType: "quote",
      entityId: row.id,
      diff: { before: null, after: { total: result.money.total, releaseIds: stamps.releaseIds } },
    });
    // Admin margin-floor override (ADR 0056) — a distinct, attributable audit
    // entry on the now-existing quote (CORE_SPEC §7: margin floor is the single
    // approval mechanism, every breach is on the ledger). Records the REAL
    // margin and per-org floor that were in effect (ADR 0059).
    if (marginAudit) {
      await this.audit.record({
        actorId: scope.userId,
        action: "quote.margin_override",
        entityType: "quote",
        entityId: row.id,
        diff: { before: null, after: marginAudit },
      });
    }
    // The issuer (admin/sales) is never price-blind, but route the response
    // through the same role-aware mapper for one consistent projection path.
    return toDetail(row, role);
  }

  /**
   * I3 acceptance: reload the EXACT immutable inputs the stamps point at, re-run
   * the pure engine + renderers with the stamped kerf, and deep-equal every
   * frozen artifact. Two robustness rules make this sound across the JSONB
   * round-trip: (1) the roster is sorted by instanceId (canonical order) so the
   * engine's order-sensitive arrays match — Postgres JSONB does NOT preserve
   * object key order; (2) the comparison trusts the I10 money STRINGS, never the
   * raw internal floats (`totals`, `bom[].totalPrice`) which need not survive
   * JSONB exactly.
   */
  async verifyReproducibility(scope: RequestScope, quoteId: string): Promise<QuoteReproduction> {
    const row = await this.quotes.findById(scope, quoteId);
    if (!row) throw new NotFoundException("Quote not found");
    const snapshot = row.snapshot as QuoteSnapshot;
    const stamps = row.stamps as QuoteStamps;
    const mismatches: string[] = [];

    const siteInstances: SiteInstance[] = [];
    for (const [instanceId, snap] of Object.entries(snapshot.inputs)) {
      const detail = await this.releases.loadByReleaseId(snap.releaseId);
      if (!detail) {
        mismatches.push(`release:${snap.releaseId}:missing`);
        continue;
      }
      siteInstances.push({
        instanceId,
        release: detail.body as ProductModelRelease,
        input: snap.input,
        ...(snap.overrides !== undefined ? { overrides: snap.overrides } : {}),
      });
    }
    siteInstances.sort(byInstanceId); // canonical order — JSONB dropped the issue-time order
    const catalog = await this.catalogVersions.loadCatalog(stamps.catalogVersion);
    if (!catalog) mismatches.push(`catalog@${stamps.catalogVersion}:missing`);
    const priceTable = await this.priceTables.loadByVersion(scope, stamps.priceTableVersion);
    if (!priceTable) mismatches.push(`priceTable@${stamps.priceTableVersion}:missing`);

    if (mismatches.length > 0) return { quoteId, reproduced: false, mismatches };

    // Re-run the SAME pure path against the stamped immutable inputs (I3) — the
    // cost layer rides the same stamped price-table row (ADR 0059), so it
    // re-derives from the reloaded table with no extra stamp.
    const costs = (priceTable!.cost ?? undefined) as CostTable | undefined;
    const result = deriveSite(snapshot.site, siteInstances, priceTable!.table as never, catalog!, {
      ...(costs !== undefined && { costs }),
    });
    if (!result.isValid)
      return { quoteId, reproduced: false, mismatches: ["re-derivation:invalid"] };
    const fresh = artifactsOf(result, snapshot.site, snapshot.cutOptions.kerfMm);

    // Compare the I10-canonical representation (money strings), never the raw
    // internal floats: `money` (MoneyTotals) stands in for `totals`, and the BOM
    // is compared via `totalPriceMoney` (bomForCompare drops `totalPrice`). Cost
    // is compared the same way — `costMoney` strings, not the raw cost floats
    // (both undefined when no cost layer → deep-equal holds).
    const checks: Array<readonly [string, unknown, unknown]> = [
      ["bom", bomForCompare(fresh.bom), bomForCompare(snapshot.bom)],
      ["money", fresh.money, snapshot.money],
      ["costMoney", fresh.costMoney, snapshot.costMoney],
      ["cutList", fresh.cutList, snapshot.cutList],
      ["drawings", fresh.drawings, snapshot.drawings],
    ];
    for (const [key, a, b] of checks) if (!isDeepStrictEqual(a, b)) mismatches.push(key);
    // Stamps must re-derive identically too (release pins + versions + override set).
    if (!isDeepStrictEqual(result.stamps, stamps)) mismatches.push("stamps");

    return { quoteId, reproduced: mismatches.length === 0, mismatches };
  }
}
