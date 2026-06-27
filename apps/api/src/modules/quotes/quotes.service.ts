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
  ConflictException,
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
import {
  addMoney,
  deriveTaxBreakdown,
  resolveTaxMode,
  type Catalog,
  type ProductModelRelease,
  type RoundingPolicy,
  type Site,
  type TaxBreakdown,
  type TaxModeKind,
} from "@repo/model";
import {
  buildCutList,
  buildSitePlan,
  buildWorkshopDrawing,
  type CutList,
  type SitePlan,
  type WorkshopDrawing,
} from "@repo/renderers";
import { type PriceTableDetail } from "@repo/validators/price-tables";
import {
  type IssueQuoteInput,
  type ListQuotesQuery,
  type QuoteAcceptance,
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
import { CustomersService } from "../customers/customers.service.js";
import { LegalProfilesService } from "../legal-profiles/legal-profiles.service.js";
import { PriceTablesService } from "../price-tables/price-tables.service.js";
import { ReleasesService } from "../releases/releases.service.js";
import { formatQuoteNumber } from "./document-number.js";
import { quoteMarginPct } from "./margin.js";
import { canBuyerResolve, effectiveStatus } from "./quote-lifecycle.js";
import { QuotesRepository, type QuoteScopeOpts } from "./quotes.repository.js";

/** admin sees the whole org; every other rep is narrowed to their own quotes. */
function scopeOpts(role: OrgRole): QuoteScopeOpts {
  return { restrictToOwner: role !== "admin" };
}

/**
 * The buyer identity FROZEN onto the issued document at issue (ADR 0086,
 * realizing ADR 0071). A CAPTURED FACT — copied from the (mutable) customer
 * entity, never re-derived — so it is deliberately ABSENT from the I3 `checks`
 * (verifyReproducibility compares only re-derived artifacts) AND it SURVIVES the
 * customer's Art.17 anonymization untouched: the issued daňový doklad retains
 * its buyer fields under the legal-obligation basis while the live customer goes
 * PII-free. The field-set is the document-identifying subset only — email/phone/
 * note are NOT frozen (data minimisation: contact, not document identity).
 * PROVISIONAL: the EXACT retained set + statutory period are accountant-gated
 * (the ADR-0071 open check).
 */
interface FrozenCustomerIdentity {
  /** Link back to the (mutable) live row — navigation only; the identity is frozen. */
  customerId: string;
  name: string;
  ico: string | null;
  dic: string | null;
  vatPayer: boolean;
  addressLine: string | null;
  city: string | null;
  postalCode: string | null;
  country: string;
}

/**
 * The supplier (dodavatel) identity FROZEN onto the issued document at issue
 * (ADR 0088, the same captured-fact pattern as the buyer block above). It is the
 * §29-ZDPH supplier block of the daňový doklad — copied from the org's mutable
 * legal profile, so editing the profile NEVER retro-alters an issued document
 * (I3); like the buyer, it is ABSENT from the verifyReproducibility `checks`.
 * Always present on a quote issued after the legal-profile slice (`issue` 422s
 * `legal_profile_required` without one); absent only on a legacy quote.
 */
interface FrozenSupplierIdentity {
  name: string;
  ico: string | null;
  dic: string | null;
  vatPayer: boolean;
  addressLine: string | null;
  city: string | null;
  postalCode: string | null;
  country: string;
  bankAccount: string | null;
  registrationNote: string | null;
}

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
  /** The structured §92e/DPH tax document (ADR 0080) — frozen so a re-derived
   *  quote reproduces its tax breakdown byte-identically (I3). Carries the rate
   *  lines + the rounding policy + the §92e legend. */
  tax: TaxBreakdown;
  /** The buyer identity frozen at issue (ADR 0086/0071) — a captured fact, NOT
   *  re-derived (so absent from the I3 `checks`) and NOT erased when the live
   *  customer is anonymized. Absent for an unattached (walk-in) quote. */
  customer?: FrozenCustomerIdentity;
  /** The supplier (dodavatel) identity frozen at issue (ADR 0088) — the same
   *  captured-fact pattern as `customer`. Present on every quote issued after the
   *  legal-profile slice (issue 422s without one); optional only so a legacy quote
   *  still casts. NOT in the I3 `checks` (a captured fact, not re-derived). */
  supplier?: FrozenSupplierIdentity;
}

/**
 * Compute the structured tax breakdown over a derived result (ADR 0080). Pure +
 * deterministic, so it re-derives (I3): the net rate-base comes from the I10
 * money strings (per-line sum for `per-line` granularity, the rolled-up net for
 * `end-of-invoice`), the rate + rounding policy from the (immutable, stamped)
 * price table, and the §92e/standard `mode` from the caller. Single rate today;
 * the breakdown shape carries many (mixed-rate is a data change).
 */
function computeQuoteTax(
  result: SiteResult,
  priceTable: PriceTableDetail,
  mode: TaxModeKind,
): TaxBreakdown {
  const policy = priceTable.roundingPolicy as RoundingPolicy;
  const netBase =
    policy.granularity === "per-line"
      ? addMoney(result.bom.map((l) => l.totalPriceMoney))
      : result.money.total;
  return deriveTaxBreakdown(
    [{ ratePct: priceTable.dphRate, netBase }],
    mode,
    policy,
    priceTable.currency,
  );
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
 * forgotten. The frozen buyer PII (`customer`, ADR 0086) is likewise NOT
 * whitelisted, so the workshop never sees the odběratel. Stripping happens HERE,
 * server-side, never merely FE-hidden.
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
    customerId: row.customerId,
    // `expired` is derived from validUntil at read time (ADR 0083) — never stored.
    status: effectiveStatus(row.status, row.validUntil, new Date()),
    documentNumber: row.documentNumber,
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
    private readonly customers: CustomersService,
    private readonly legalProfiles: LegalProfilesService,
    private readonly audit: AuditService,
  ) {}

  async list(scope: RequestScope, role: OrgRole, query: ListQuotesQuery): Promise<QuotesPage> {
    const { items, nextCursor } = await this.quotes.list(scope, scopeOpts(role), query);
    return { items: items.map((row) => toSummary(row, role)), nextCursor };
  }

  async get(scope: RequestScope, role: OrgRole, quoteId: string): Promise<QuoteDetail> {
    const row = await this.quotes.findById(scope, scopeOpts(role), quoteId);
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

    // Per-release catalog (ADR 0065): each release derives against its OWN pinned
    // catalog version — mixed versions coexist in one site. Load each DISTINCT
    // version once, then key by releaseId so the engine routes every instance to
    // its catalog (instances sharing a version share the Catalog object). This
    // replaces the old single-catalog `mixed_catalog` 422.
    const distinctVersions = [...new Set(loaded.map((l) => l.detail.catalogVersion))];
    const catalogByVersion = new Map<number, Catalog>(
      await Promise.all(
        distinctVersions.map(async (v): Promise<[number, Catalog]> => {
          const c = await this.catalogVersions.loadCatalog(v);
          if (!c) throw new BadRequestException(`catalog@${v} is not published`);
          return [v, c];
        }),
      ),
    );
    const catalogs = new Map<string, Catalog>(
      loaded.map(({ detail }) => [
        (detail.body as ProductModelRelease).id,
        catalogByVersion.get(detail.catalogVersion)!,
      ]),
    );

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
    const result = deriveSite(site, siteInstances, priceTable.table as never, catalogs, {
      ...(costs !== undefined && { costs }),
      // Round money to the table's commercial policy (ADR 0081) — the same
      // policy verify re-derives under (the table is immutable, I3).
      rounding: priceTable.roundingPolicy as RoundingPolicy,
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
    // reproducibility (golden 129891.5, re-baselined ADR 0081) holds. A floor with no cost data is a
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

    // Attach the buyer (ADR 0082) — ownership-validated via the customers service
    // (404 on another rep's / a missing customer; the rep must own it or be admin).
    const attachedCustomer = input.customerId
      ? await this.customers.get(scope, role, input.customerId)
      : null;

    // The supplier (dodavatel) — the org's own legal identity (ADR 0088). A
    // complete daňový doklad (§29 ZDPH) legally requires the supplier block, so a
    // not-yet-completed profile is a hard 422 (no honest legal document without a
    // supplier identity), never a silent placeholder. Loaded server-side here so
    // any rep can issue (the live profile is admin-edited, but reading it to issue
    // is not role-gated); frozen into the snapshot below.
    const supplierProfile = await this.legalProfiles.get(scope);
    if (!supplierProfile) {
      throw new UnprocessableEntityException({
        message: "the organization has not completed its legal profile",
        code: "legal_profile_required",
      });
    }

    // §92e/DPH (ADR 0080) — the tax mode is a per-transaction decision. The
    // supplier's VAT-payer status comes from its legal profile (ADR 0088 — a
    // non-VAT-payer supplier can never reverse-charge); the buyer's is auto-filled
    // from the attached customer when present (else the request flag), and the
    // construction/assembly scope from the request. The structured breakdown is
    // frozen below and re-derived at verify from the frozen mode (I3).
    const taxMode = resolveTaxMode({
      supplierVatPayer: supplierProfile.vatPayer,
      customerVatPayer: attachedCustomer?.vatPayer ?? input.tax?.customerVatPayer ?? false,
      constructionAssembly: input.tax?.constructionAssembly ?? false,
    });
    const tax = computeQuoteTax(result, priceTable, taxMode);

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
      tax,
      // Freeze the supplier (dodavatel) identity onto the document (ADR 0088) —
      // captured from the org legal profile here, so a later profile edit never
      // retro-alters this issued daňový doklad (I3). A captured fact like the
      // buyer below — absent from the verifyReproducibility `checks`.
      supplier: {
        name: supplierProfile.name,
        ico: supplierProfile.ico,
        dic: supplierProfile.dic,
        vatPayer: supplierProfile.vatPayer,
        addressLine: supplierProfile.addressLine,
        city: supplierProfile.city,
        postalCode: supplierProfile.postalCode,
        country: supplierProfile.country,
        bankAccount: supplierProfile.bankAccount,
        registrationNote: supplierProfile.registrationNote,
      },
      // Freeze the buyer identity onto the document (ADR 0086/0071) — captured
      // from the live customer here, retained even after Art.17 anonymizes it.
      ...(attachedCustomer && {
        customer: {
          customerId: attachedCustomer.id,
          name: attachedCustomer.name,
          ico: attachedCustomer.ico,
          dic: attachedCustomer.dic,
          vatPayer: attachedCustomer.vatPayer,
          addressLine: attachedCustomer.addressLine,
          city: attachedCustomer.city,
          postalCode: attachedCustomer.postalCode,
          country: attachedCustomer.country,
        },
      }),
    };
    const stamps = result.stamps;

    // Allocate the gap-free document number INSIDE this issue transaction (ADR
    // 0079): the increment commits or rolls back with the quote insert below, so
    // a failed issue leaves no gap in the org's per-year series. The wall clock
    // lives in the app layer (like shareToken), never the engine.
    const year = new Date().getFullYear();
    const documentNumber = formatQuoteNumber(year, await this.quotes.allocateNumber(scope, year));

    const row = await this.quotes.insert(scope, {
      projectId: input.projectId ?? null,
      customerId: attachedCustomer?.id ?? null,
      status: "issued",
      documentNumber,
      currency: priceTable.currency,
      shareToken: randomUUID(),
      validUntil: input.validUntil ? new Date(input.validUntil) : null,
      totalMoney: result.money.total,
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
  async verifyReproducibility(
    scope: RequestScope,
    role: OrgRole,
    quoteId: string,
  ): Promise<QuoteReproduction> {
    const row = await this.quotes.findById(scope, scopeOpts(role), quoteId);
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
    // Per-release catalog (ADR 0065): load each DISTINCT stamped catalog version,
    // then key by releaseId for the engine. A stamped version that no longer
    // loads is a reproduction failure, surfaced per missing version. I3 ≠
    // visibility/pin holds — re-derivation never re-checks assignment or the pin.
    const catalogByVersion = new Map<number, Catalog>();
    for (const v of new Set(Object.values(stamps.catalogVersions))) {
      const c = await this.catalogVersions.loadCatalog(v);
      if (c) catalogByVersion.set(v, c);
      else mismatches.push(`catalog@${v}:missing`);
    }
    const priceTable = await this.priceTables.loadByVersion(scope, stamps.priceTableVersion);
    if (!priceTable) mismatches.push(`priceTable@${stamps.priceTableVersion}:missing`);

    if (mismatches.length > 0) return { quoteId, reproduced: false, mismatches };

    const catalogs = new Map<string, Catalog>(
      Object.entries(stamps.catalogVersions).map(([releaseId, v]) => [
        releaseId,
        catalogByVersion.get(v)!,
      ]),
    );

    // Re-run the SAME pure path against the stamped immutable inputs (I3) — the
    // cost layer rides the same stamped price-table row (ADR 0059), so it
    // re-derives from the reloaded table with no extra stamp.
    const costs = (priceTable!.cost ?? undefined) as CostTable | undefined;
    const result = deriveSite(snapshot.site, siteInstances, priceTable!.table as never, catalogs, {
      ...(costs !== undefined && { costs }),
      rounding: priceTable!.roundingPolicy as RoundingPolicy,
    });
    if (!result.isValid)
      return { quoteId, reproduced: false, mismatches: ["re-derivation:invalid"] };
    const fresh = artifactsOf(result, snapshot.site, snapshot.cutOptions.kerfMm);
    // Re-derive the structured tax document from the SAME stamped inputs + the
    // frozen mode (a per-transaction decision, not derivable from stamps) — it
    // must reproduce the frozen breakdown byte-identically (I3, ADR 0080).
    const freshTax = computeQuoteTax(result, priceTable!, snapshot.tax.mode);

    // Compare the I10-canonical representation (money strings), never the raw
    // internal floats: `money` (MoneyTotals) stands in for `totals`, and the BOM
    // is compared via `totalPriceMoney` (bomForCompare drops `totalPrice`). Cost
    // is compared the same way — `costMoney` strings, not the raw cost floats
    // (both undefined when no cost layer → deep-equal holds).
    // NB: snapshot.customer (ADR 0086) and snapshot.supplier (ADR 0088) are
    // deliberately NOT checks — the frozen buyer and the frozen dodavatel are
    // captured facts, not re-derived artifacts, so they have no fresh counterpart
    // to compare and must not gate reproducibility (the buyer survives a
    // since-anonymized customer; the supplier survives a since-edited org profile).
    const checks: Array<readonly [string, unknown, unknown]> = [
      ["bom", bomForCompare(fresh.bom), bomForCompare(snapshot.bom)],
      ["money", fresh.money, snapshot.money],
      ["costMoney", fresh.costMoney, snapshot.costMoney],
      ["cutList", fresh.cutList, snapshot.cutList],
      ["drawings", fresh.drawings, snapshot.drawings],
      ["tax", freshTax, snapshot.tax],
    ];
    for (const [key, a, b] of checks) if (!isDeepStrictEqual(a, b)) mismatches.push(key);
    // Stamps must re-derive identically too (release pins + versions + override set).
    if (!isDeepStrictEqual(result.stamps, stamps)) mismatches.push("stamps");

    return { quoteId, reproduced: mismatches.length === 0, mismatches };
  }

  /**
   * Buyer resolution via the shareToken (ADR 0083) — the unauthenticated
   * accept/decline path. The unguessable token IS the authorization (no org
   * scope). Legal only from an *effectively* `issued` quote (live, not lapsed,
   * not already resolved) — else 409. The I3 snapshot is untouched; only the
   * status moves. Audited with a null actor (an external party). Idempotent-safe:
   * a second accept on an already-accepted quote 409s rather than re-emitting.
   */
  @Transactional()
  private async resolveByShareToken(
    shareToken: string,
    to: "accepted" | "declined",
  ): Promise<QuoteAcceptance> {
    const row = await this.quotes.findByShareToken(shareToken);
    if (!row) throw new NotFoundException("Quote not found");
    const effective = effectiveStatus(row.status, row.validUntil, new Date());
    if (!canBuyerResolve(effective)) {
      throw new ConflictException({
        message: `quote is ${effective}, not open for buyer resolution`,
        code: "quote_not_open",
        status: effective,
      });
    }
    await this.quotes.setStatus(row.id, to);
    await this.audit.record({
      actorId: null, // an external buyer, not a platform user
      action: to === "accepted" ? "quote.accept" : "quote.decline",
      entityType: "quote",
      entityId: row.id,
      diff: { before: { status: "issued" }, after: { status: to, via: "shareToken" } },
    });
    return { documentNumber: row.documentNumber, status: to };
  }

  acceptByShareToken(shareToken: string): Promise<QuoteAcceptance> {
    return this.resolveByShareToken(shareToken, "accepted");
  }

  declineByShareToken(shareToken: string): Promise<QuoteAcceptance> {
    return this.resolveByShareToken(shareToken, "declined");
  }
}
