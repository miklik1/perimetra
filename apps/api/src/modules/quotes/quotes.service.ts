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
  buildScope,
  deriveSite,
  type CascadeLayers,
  type CategoryTotals,
  type ConfigInput,
  type CostTable,
  type MoneyTotals,
  type PriceLayer,
  type SiteBomLine,
  type SiteInstance,
  type SiteResult,
} from "@repo/engine";
import {
  addMoney,
  deriveTaxBreakdown,
  evalString,
  resolveTaxMode,
  resolveUi,
  type Catalog,
  type DrawingSpec,
  type OptionSet,
  type ParameterDef,
  type ProductModelRelease,
  type RoundingPolicy,
  type Scope,
  type Site,
  type TaxBreakdown,
  type TaxModeKind,
  type Value,
} from "@repo/model";
import {
  buildCutList,
  buildNabidka,
  buildSitePlan,
  buildTechnicalDrawing,
  buildWorkshopDrawing,
  type CutList,
  type NabidkaCustomer,
  type NabidkaSupplier,
  type SitePlan,
  type TechnicalDrawing,
  type WorkshopDrawing,
} from "@repo/renderers";
import { type LedgerRebuildResult } from "@repo/validators/ledger";
import { type PriceTableDetail } from "@repo/validators/price-tables";
import {
  type IssueQuoteInput,
  type ListQuotesQuery,
  type QuoteAcceptance,
  type QuoteDetail,
  type QuoteProduction,
  type QuoteReproduction,
  type QuotesPage,
  type QuoteStamps,
  type QuoteSummary,
  type SharedNabidka,
} from "@repo/validators/quotes";

import { isPriceBlind, type OrgRole } from "../../common/rbac/org-role.js";
import { type RequestScope } from "../../common/tenancy/request-scope.js";
import { AuditService } from "../audit/audit.service.js";
import { CatalogVersionsService } from "../catalog-versions/catalog-versions.service.js";
import { CustomersService } from "../customers/customers.service.js";
import { LedgerService } from "../ledger/ledger.service.js";
import { LegalProfilesService } from "../legal-profiles/legal-profiles.service.js";
import { NumberingService } from "../numbering/numbering.service.js";
import { PriceTablesService } from "../price-tables/price-tables.service.js";
import { ReleasesService } from "../releases/releases.service.js";
import { formatQuoteNumber } from "./document-number.js";
import { quoteMarginPct } from "./margin.js";
import { isProducible, productionSafeDrawing, toProduction } from "./production.js";
import { canBuyerResolve, effectiveStatus } from "./quote-lifecycle.js";
import { QuotesRepository, type QuoteScopeOpts } from "./quotes.repository.js";

/**
 * Ownership narrowing (ADR 0082) is a SALES-pipeline concept — `sales` sees
 * only their own quotes; `admin` sees the whole org (the tenant owner). Widened
 * (CAR-24) so `workshop` ALSO sees the whole org: workshop never owns a quote
 * (issuing is `@RequireRole("admin","sales")`), so the old `role !== "admin"`
 * narrowing left workshop's list/detail/production permanently empty — a
 * price-blind read is still an org-wide read, not an ownership one.
 */
function scopeOpts(role: OrgRole): QuoteScopeOpts {
  return { restrictToOwner: role === "sales" };
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

/** One frozen spec-sheet row (ADR 0108): the §8 UiSpec label + the display
 *  value off the frozen ConfigInput. The label is release DATA (never app i18n);
 *  captured at issue so `getProduction` reads it without loading a release. */
interface FrozenSpecRow {
  key: string;
  label: string;
  value: string;
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
  /** The derived 2D technical drawing per instance (ADR 0102/0108) — feature-
   *  bound dimensions/labels off the release's immutable DrawingSpec. Frozen +
   *  re-derived, so a historical quote reproduces its drawing byte-identically
   *  (I3). Deliberately a TOP-LEVEL field, NOT nested under `drawings`:
   *  `drawings` is deep-equal-compared in verifyReproducibility, so nesting it
   *  there would make EVERY quote issued before this slice mismatch —
   *  retroactively breaking I3 on historical quotes. Optional for the same
   *  reason (a pre-slice snapshot carries none); the verify check is N-1-guarded. */
  technicalDrawings?: Record<string, TechnicalDrawing>;
  /** Frozen spec-sheet rows per instance (ADR 0108) — the release's §8 UiSpec
   *  labels + the display value off the frozen ConfigInput, captured at issue so
   *  `getProduction` stays a PURE snapshot read (ADR 0101: never loads a release,
   *  never re-derives). Like `customer`/`supplier` it is a captured fact off
   *  immutable release data, NOT a re-derived engine artifact — so it is absent
   *  from the verifyReproducibility `checks`. Optional: a pre-slice snapshot has none. */
  specRows?: Record<string, FrozenSpecRow[]>;
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

/** The frozen artifacts (bom/totals/money/cost/cutList/drawings/technicalDrawings)
 *  off a site result. `specs` is the per-instance DrawingSpec (release data),
 *  threaded from `release.drawing` by both callers (issue + verify) so the
 *  technical drawing re-derives identically (I3). */
function artifactsOf(
  result: SiteResult,
  site: Site,
  kerfMm: number,
  specs: Record<string, DrawingSpec | undefined>,
) {
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
    // The 2D technical drawing (ADR 0102) off the SAME baked geometry the workshop
    // drawing uses, driven by each instance's release DrawingSpec (absent ⇒ the
    // emitter's default overall-dims fallback). Pure + deterministic → re-derives.
    technicalDrawings: Object.fromEntries(
      Object.entries(result.instances).map(([id, r]) => [id, buildTechnicalDrawing(r, specs[id])]),
    ),
  };
}

/** The per-instance DrawingSpec map `artifactsOf` needs — keyed by instanceId,
 *  read off each release's immutable `drawing` field (release DATA). */
function drawingSpecs(instances: SiteInstance[]): Record<string, DrawingSpec | undefined> {
  return Object.fromEntries(instances.map((i) => [i.instanceId, i.release.drawing]));
}

/** Format one parameter's frozen value for the spec sheet — mirrors the
 *  configurator's Souhrn (`apps/web/app/configurator/summary.tsx`): an option-
 *  carried value shows its release-authored label, a length shows its `mm`, else
 *  the raw value. No app i18n — the wording is release DATA (§8). */
function specDisplayValue(
  def: ParameterDef,
  value: Value | undefined,
  optionSets: OptionSet[],
): string {
  if (value === undefined || value === "") return "—";
  const option = optionSets
    .find((s) => s.options.some((o) => o.id === value))
    ?.options.find((o) => o.id === value);
  if (option !== undefined) return option.label ?? option.id;
  if (def.type === "length_mm") return `${String(value)} mm`;
  return String(value);
}

/**
 * The scope a spec-sheet VALUE may be read from: parameter defaults + the frozen
 * `ConfigInput`, and **never the price layer**.
 *
 * `buildScope` seeds itself with `priceScope(prices)`, so a parameter whose
 * `defaultExpr` reads a `price.*` key resolves to a price-table number — which
 * would then be printed verbatim on the price-blind workshop sheet (e.g. a param
 * defaulting to `price.manufacturing_rate`, a CZK/hr figure). Price-blindness is
 * structural here, not a matter of remembering: with no price layer in scope, such
 * a default cannot resolve at all — `evaluate` throws on the unknown reference and
 * the parameter is simply absent, so `specDisplayValue` renders "—". Absence, never
 * a masked money value. Parameter visibility is still resolved against the FULL
 * derivation scope below (a visibility predicate prints nothing).
 */
function specValueScope(release: ProductModelRelease, input: ConfigInput): Scope {
  const scope: Scope = {};
  // Declaration order, so a later default may reference an earlier one.
  for (const param of release.parameters) {
    if (param.defaultExpr !== undefined) {
      try {
        scope[param.key] = evalString(param.defaultExpr, scope);
      } catch {
        // Price-dependent (or otherwise unresolvable without the price layer):
        // leave the key absent rather than reach for the real value.
      }
    } else if (param.default !== undefined) {
      scope[param.key] = param.default;
    }
  }
  // The buyer's frozen choices win over defaults, exactly as in `buildScope`.
  for (const [key, value] of Object.entries(input)) scope[key] = value;
  return scope;
}

/** The frozen spec-sheet rows for one instance (ADR 0108): the release's §8
 *  UiSpec labels + visibility resolved against the full derivation scope, valued
 *  from the price-free `specValueScope`. Captured at issue (never re-derived).
 *  Exported for the price-provenance unit test — the price-blindness guarantee
 *  it encodes is worth pinning directly, not only through the wire contract. */
export function buildSpecRows(
  release: ProductModelRelease,
  input: ConfigInput,
  prices: PriceLayer,
): FrozenSpecRow[] {
  // The config already derived valid at issue, so buildScope (which derivation
  // ran first) cannot throw here — reuse the engine's canonical scope builder so
  // defaults/option attrs resolve exactly as the configurator saw them. It drives
  // UI VISIBILITY only; values come from the price-free scope.
  const scope: Scope = buildScope(release, input, prices);
  const values: Scope = specValueScope(release, input);
  const optionSets = release.optionSets ?? [];
  return resolveUi(release, scope)
    .flatMap((step) => step.groups)
    .flatMap((group) => group.params)
    .filter((p) => p.visible)
    .map((p) => ({
      key: p.def.key,
      label: p.def.label ?? p.def.key,
      value: specDisplayValue(p.def, values[p.def.key], optionSets),
    }));
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
    // A part's cascade override can target the COMMERCIAL `pricePerUnit`/
    // `totalPrice` ArtifactFields, not just quantity/lengthMm — without this,
    // an overridden part's raw price float would ride the deviation flag
    // straight through this whitelist (`production.ts`'s narrow I10 leak
    // vector, CAR-24 — same fix, applied here too for the price-blind detail).
    drawings: {
      site: snapshot.drawings.site,
      instances: Object.fromEntries(
        Object.entries(snapshot.drawings.instances).map(([id, d]) => [
          id,
          productionSafeDrawing(d),
        ]),
      ),
    },
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
    revisionOfId: row.revisionOfId,
    supersededById: row.supersededById,
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
    private readonly ledger: LedgerService,
    private readonly numbering: NumberingService,
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

  /**
   * The workshop PRODUCTION view (CAR-24) — cut list + BOM quantities + 2D
   * drawings off the FROZEN snapshot (never re-derived, I3). ROLE-INDEPENDENT:
   * unlike `get`, every caller (admin/sales/workshop) sees the identical
   * price-blind shape — production is a distinct SURFACE, not a permission
   * level, so there is no role branch here at all. Ownership scope is the SAME
   * widened `scopeOpts` as `get`/`list` (workshop sees the whole org, ADR
   * above). Gated to an effectively issued/accepted quote (`isProducible`) —
   * a draft/declined/expired quote 404s (absence, not a 403 — consistent with
   * the org-scope-isolation "no existence oracle" precedent).
   */
  async getProduction(
    scope: RequestScope,
    role: OrgRole,
    quoteId: string,
  ): Promise<QuoteProduction> {
    const row = await this.quotes.findById(scope, scopeOpts(role), quoteId);
    if (!row) throw new NotFoundException("Quote not found");
    const effective = effectiveStatus(row.status, row.validUntil, new Date());
    if (!isProducible(effective)) throw new NotFoundException("Quote not found");
    return toProduction(row, effective, row.snapshot as QuoteSnapshot);
  }

  /**
   * Cross-module seam for the orders module (ADR 0109 / ADR-O1): assert the
   * quote a new order references is effectively `accepted`. Org-scoped but NOT
   * owner-narrowed — order creation is gated by org membership + role, not quote
   * ownership. 404 (absent/other-org) / 409 `quote_not_accepted`.
   */
  async assertAcceptedForOrder(scope: RequestScope, quoteId: string): Promise<void> {
    const row = await this.quotes.findById(scope, { restrictToOwner: false }, quoteId);
    if (!row) throw new NotFoundException("Quote not found");
    const effective = effectiveStatus(row.status, row.validUntil, new Date());
    if (effective !== "accepted") {
      throw new ConflictException({
        message: `quote is ${effective}, not accepted`,
        code: "quote_not_accepted",
        status: effective,
      });
    }
  }

  /**
   * Cross-module seam for order re-point (ADR-O1, CAR-158): the target quote
   * must be effectively `accepted` AND a FORWARD member of `fromQuoteId`'s
   * supersession chain (a later revision reachable via `supersededById`) —
   * re-pointing to an unrelated or older quote 409s. Org-scoped, not
   * owner-narrowed (order access already gated the caller).
   */
  async assertRepointTarget(
    scope: RequestScope,
    fromQuoteId: string,
    toQuoteId: string,
  ): Promise<void> {
    const target = await this.quotes.findById(scope, { restrictToOwner: false }, toQuoteId);
    if (!target) throw new NotFoundException("Quote not found");
    const effective = effectiveStatus(target.status, target.validUntil, new Date());
    if (effective !== "accepted") {
      throw new ConflictException({
        message: `quote is ${effective}, not accepted`,
        code: "quote_not_accepted",
        status: effective,
      });
    }
    // Walk the linear chain forward from the order's current quote; the target
    // must be reachable (a later revision), else it is not the same deal.
    let cursor: string | null = fromQuoteId;
    const seen = new Set<string>();
    while (cursor && cursor !== toQuoteId) {
      if (seen.has(cursor)) break; // cycle guard (chains are linear — belt & braces)
      seen.add(cursor);
      const row = await this.quotes.findById(scope, { restrictToOwner: false }, cursor);
      cursor = row?.supersededById ?? null;
    }
    if (cursor !== toQuoteId) {
      throw new ConflictException({
        message: "target quote is not a revision of this order's quote",
        code: "quote_not_in_chain",
      });
    }
  }

  /**
   * Cross-module seam for the orders production re-home (ADR 0109 / ADR-O1):
   * the price-blind production projection for an order's underlying quote,
   * resolved off the FROZEN snapshot verbatim (I3). Org-scoped, NOT
   * owner-narrowed — the caller already gated on order access (same org).
   */
  async getProductionByQuoteId(scope: RequestScope, quoteId: string): Promise<QuoteProduction> {
    const row = await this.quotes.findById(scope, { restrictToOwner: false }, quoteId);
    if (!row) throw new NotFoundException("Quote not found");
    const effective = effectiveStatus(row.status, row.validUntil, new Date());
    if (!isProducible(effective)) throw new NotFoundException("Quote not found");
    return toProduction(row, effective, row.snapshot as QuoteSnapshot);
  }

  /**
   * Rebuild the deviation ledger's snapshot-derivable rows (ADR-O4, CAR-159) —
   * the drift-repair maintenance op. QuotesService orchestrates it because it
   * owns the frozen snapshots (keeps the quotes→ledger dependency one-way);
   * `LedgerService` re-projects atomically, leaving the authoritative
   * margin/order-exception rows untouched. Admin-only at the controller.
   */
  async rebuildLedger(scope: RequestScope): Promise<LedgerRebuildResult> {
    const rows = await this.quotes.findAllWithSnapshot(scope);
    const projected = await this.ledger.rebuildQuoteOverrides(
      scope,
      rows.map((r) => ({ quoteId: r.id, snapshot: r.snapshot })),
    );
    return { projected };
  }

  /** Issue a fresh quote — freeze a re-derivable snapshot (ADR 0053, I3). */
  @Transactional()
  async issue(scope: RequestScope, role: OrgRole, input: IssueQuoteInput): Promise<QuoteDetail> {
    return toDetail(await this.issueQuoteRow(scope, role, input, null), role);
  }

  /**
   * Revise a quote (ADR 0109 / ADR-O1, CAR-158): issue a NEW fully re-derived
   * snapshot linked to the old via `revisionOfId`, and supersede the old in the
   * SAME transaction. Chains are linear: the supersede is a conditional update
   * (`WHERE superseded_by_id IS NULL`), so a revise-vs-revise race resolves to
   * one winner and one 409 `quote_already_superseded` (the loser's freshly
   * inserted new quote + its allocated number roll back with the tx — no gap, no
   * orphan). The new number continues the same gap-free series; the old buyer
   * link keeps rendering the old document but REFUSES resolution (quotes-public).
   */
  @Transactional()
  async revise(
    scope: RequestScope,
    role: OrgRole,
    quoteId: string,
    input: IssueQuoteInput,
  ): Promise<QuoteDetail> {
    const previous = await this.quotes.findById(scope, scopeOpts(role), quoteId);
    if (!previous) throw new NotFoundException("Quote not found");
    if (previous.supersededById) {
      throw new ConflictException({
        message: "quote is already superseded",
        code: "quote_already_superseded",
      });
    }

    const revised = await this.issueQuoteRow(scope, role, input, quoteId);

    // The race backstop: only the first revise moves the pointer; a concurrent
    // one finds it already set and 409s (its `revised` row, inserted just above,
    // rolls back with this transaction — so no orphan revision, no number gap).
    const superseded = await this.quotes.setSupersededBy(scope, quoteId, revised.id);
    if (!superseded) {
      throw new ConflictException({
        message: "quote is already superseded",
        code: "quote_already_superseded",
      });
    }

    await this.audit.record({
      actorId: scope.userId,
      action: "quote.revise",
      entityType: "quote",
      entityId: revised.id,
      diff: { before: null, after: { revisionOfId: quoteId, supersededQuoteId: quoteId } },
    });
    return toDetail(revised, role);
  }

  /**
   * The shared issue core (ADR 0053) — derive → freeze → allocate → insert →
   * audit, returning the raw row. `issue()` wraps it (`revisionOfId` null); a
   * revision passes the superseded quote's id so the new row records its lineage.
   */
  private async issueQuoteRow(
    scope: RequestScope,
    role: OrgRole,
    input: IssueQuoteInput,
    revisionOfId: string | null,
  ): Promise<QuoteRow> {
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
    // reproducibility (golden 134723.5, re-baselined ADR 0081) holds. A floor with no cost data is a
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
    const priceLayer = priceTable.table as PriceLayer;
    const snapshot: QuoteSnapshot = {
      ...artifactsOf(result, site, kerfMm, drawingSpecs(siteInstances)),
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
      // Freeze the §8 spec-sheet rows per instance (ADR 0108) off the release's
      // UiSpec + the frozen ConfigInput, so the production view reads them without
      // loading a release (ADR 0101). A captured fact — NOT in the I3 `checks`.
      specRows: Object.fromEntries(
        siteInstances.map((si) => [si.instanceId, buildSpecRows(si.release, si.input, priceLayer)]),
      ),
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
    // a failed issue leaves no gap in the org's per-year series. The counter now
    // lives in the shared `document_number_sequence` under the 'quote' series
    // (ADR 0112 §3, O2-a) — one allocator for quote/order/invoice; the human
    // string stays the Perimetra-local `formatQuoteNumber` (byte-identical). The
    // wall clock lives in the app layer (like shareToken), never the engine.
    const year = new Date().getFullYear();
    const documentNumber = formatQuoteNumber(
      year,
      await this.numbering.allocate(scope, "quote", year),
    );

    const row = await this.quotes.insert(scope, {
      projectId: input.projectId ?? null,
      customerId: attachedCustomer?.id ?? null,
      status: "issued",
      revisionOfId,
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
    // Project the deviations onto the queryable ledger (ADR-O4) in THIS tx: the
    // quote-scope overrides (a no-op for the common override-free quote) and the
    // margin override alongside its audit row above.
    await this.ledger.recordQuoteOverrides(scope, row.id, snapshot);
    if (marginAudit) {
      await this.ledger.recordMarginOverride(scope, row.id, marginAudit, scope.userId);
    }
    return row;
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
    const fresh = artifactsOf(
      result,
      snapshot.site,
      snapshot.cutOptions.kerfMm,
      drawingSpecs(siteInstances),
    );
    // Re-derive the structured tax document from the SAME stamped inputs + the
    // frozen mode (a per-transaction decision, not derivable from stamps) — it
    // must reproduce the frozen breakdown byte-identically (I3, ADR 0080).
    const freshTax = computeQuoteTax(result, priceTable!, snapshot.tax.mode);

    // Compare the I10-canonical representation (money strings), never the raw
    // internal floats: `money` (MoneyTotals) stands in for `totals`, and the BOM
    // is compared via `totalPriceMoney` (bomForCompare drops `totalPrice`). Cost
    // is compared the same way — `costMoney` strings, not the raw cost floats
    // (both undefined when no cost layer → deep-equal holds).
    // NB: snapshot.customer (ADR 0086), snapshot.supplier (ADR 0088), and
    // snapshot.specRows (ADR 0108) are deliberately NOT checks — the frozen
    // buyer, the frozen dodavatel, and the frozen spec-sheet rows are captured
    // facts off immutable release data, not re-derived engine artifacts, so they
    // have no fresh counterpart to compare and must not gate reproducibility (the
    // buyer survives a since-anonymized customer; the supplier survives a
    // since-edited org profile; the spec rows are frozen §8 labels, not geometry).
    const checks: Array<readonly [string, unknown, unknown]> = [
      ["bom", bomForCompare(fresh.bom), bomForCompare(snapshot.bom)],
      ["money", fresh.money, snapshot.money],
      ["costMoney", fresh.costMoney, snapshot.costMoney],
      ["cutList", fresh.cutList, snapshot.cutList],
      ["drawings", fresh.drawings, snapshot.drawings],
      ["tax", freshTax, snapshot.tax],
    ];
    // The frozen technical drawing (ADR 0102/0108) — the EXPAND half of
    // expand/contract: compared ONLY when the frozen snapshot carries it. A quote
    // issued before this slice has no frozen drawing and must still reproduce
    // (N-1 tolerance); one issued after MUST reproduce it byte-identically (I3).
    if (snapshot.technicalDrawings !== undefined) {
      checks.push(["technicalDrawings", fresh.technicalDrawings, snapshot.technicalDrawings]);
    }
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
    // A superseded quote's status is unchanged (supersession is a separate
    // pointer), so guard it explicitly (ADR-O1, CAR-158): a forwarded stale link
    // must never resolve — the rep sends the new link deliberately, no auto-forward.
    if (row.supersededById) {
      throw new ConflictException({
        message: "quote has been superseded by a newer revision",
        code: "quote_superseded",
      });
    }
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

  /**
   * Buyer-facing public nabídka by shareToken (ADR 0089) — the read counterpart
   * to accept/decline. UNAUTHENTICATED: the unguessable token IS the credential
   * (no org scope). Builds the pure-data `NabidkaDocument` (the L layer, ADR 0085)
   * SERVER-SIDE off the FROZEN snapshot — no re-derive, so it is byte-consistent
   * with the issued document (I3), the SAME pure `buildNabidka` the rep print
   * route runs. The boundary is load-bearing security: it returns ONLY the
   * document + effective status + validUntil, so the snapshot's cost/margin
   * (ADR 0059), re-derivation seeds (`site`/`inputs`), and the I3 `stamps` NEVER
   * cross to the unauthenticated buyer (allowlist by construction; the response
   * DTO's strip semantics are the second line).
   *
   * Unlike accept/decline this does NOT 409 a non-issued quote: a buyer who opens
   * an emailed link must always SEE their offer (accepted / declined / expired) —
   * the effective status drives an at-a-glance banner + the accept/decline
   * affordance in the view. A shareToken only ever exists on an issued-or-later
   * quote, so a resolvable token never surfaces a draft; an unknown token 404s.
   * A malformed/price-blind snapshot (no tax/money/bom) fails closed (404).
   */
  async getSharedNabidka(shareToken: string): Promise<SharedNabidka> {
    const row = await this.quotes.findByShareToken(shareToken);
    if (!row) throw new NotFoundException("Quote not found");
    const snapshot = row.snapshot as QuoteSnapshot;
    // Fail closed on a partial/price-blind snapshot (a 404, never a 500): every
    // field buildNabidka reads must be present. Always true for an issued quote.
    if (!snapshot.tax || !snapshot.money || !snapshot.bom || !snapshot.site) {
      throw new NotFoundException("Quote not found");
    }

    const supplier: NabidkaSupplier | null = snapshot.supplier
      ? {
          name: snapshot.supplier.name,
          ico: snapshot.supplier.ico,
          dic: snapshot.supplier.dic,
          addressLine: snapshot.supplier.addressLine,
          city: snapshot.supplier.city,
          postalCode: snapshot.supplier.postalCode,
          bankAccount: snapshot.supplier.bankAccount,
          registrationNote: snapshot.supplier.registrationNote,
        }
      : null;
    const customer: NabidkaCustomer | null = snapshot.customer
      ? {
          name: snapshot.customer.name,
          ico: snapshot.customer.ico,
          dic: snapshot.customer.dic,
          addressLine: snapshot.customer.addressLine,
          city: snapshot.customer.city,
          postalCode: snapshot.customer.postalCode,
        }
      : null;

    const document = buildNabidka(
      snapshot.site,
      { bom: snapshot.bom, money: snapshot.money },
      { documentNumber: row.documentNumber, tax: snapshot.tax, supplier, customer },
    );
    return {
      document,
      status: effectiveStatus(row.status, row.validUntil, new Date()),
      validUntil: row.validUntil ? row.validUntil.toISOString() : null,
      superseded: row.supersededById !== null,
    };
  }
}
