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

import { type RequestScope } from "../../common/tenancy/request-scope.js";
import { AuditService } from "../audit/audit.service.js";
import { CatalogVersionsService } from "../catalog-versions/catalog-versions.service.js";
import { PriceTablesService } from "../price-tables/price-tables.service.js";
import { ReleasesService } from "../releases/releases.service.js";
import { QuotesRepository } from "./quotes.repository.js";

/** The frozen outputs + the minimal re-derivation seed (raw inputs + site). */
interface QuoteSnapshot {
  bom: SiteBomLine[];
  totals: CategoryTotals;
  money: MoneyTotals;
  cutList: CutList;
  drawings: { site: SitePlan; instances: Record<string, WorkshopDrawing> };
  inputs: Record<string, { releaseId: string; input: ConfigInput; overrides?: CascadeLayers }>;
  site: Site;
  cutOptions: { kerfMm: number };
}

/** The frozen artifacts (bom/totals/money/cutList/drawings) off a site result. */
function artifactsOf(result: SiteResult, site: Site, kerfMm: number) {
  return {
    bom: result.bom,
    totals: result.totals,
    money: result.money,
    cutList: buildCutList(result, { kerfMm }),
    drawings: {
      site: buildSitePlan(site, result),
      instances: Object.fromEntries(
        Object.entries(result.instances).map(([id, r]) => [id, buildWorkshopDrawing(r)]),
      ),
    },
  };
}

function toSummary(row: QuoteRow): QuoteSummary {
  return {
    id: row.id,
    projectId: row.projectId,
    status: row.status,
    currency: row.currency,
    total: row.totalMoney,
    validUntil: row.validUntil ? row.validUntil.toISOString() : null,
    shareToken: row.shareToken,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toDetail(row: QuoteRow): QuoteDetail {
  return { ...toSummary(row), stamps: row.stamps as QuoteStamps, snapshot: row.snapshot };
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

  async list(scope: RequestScope, query: ListQuotesQuery): Promise<QuotesPage> {
    const { items, nextCursor } = await this.quotes.list(scope, query);
    return { items: items.map(toSummary), nextCursor };
  }

  async get(scope: RequestScope, quoteId: string): Promise<QuoteDetail> {
    const row = await this.quotes.findById(scope, quoteId);
    if (!row) throw new NotFoundException("Quote not found");
    return toDetail(row);
  }

  @Transactional()
  async issue(scope: RequestScope, input: IssueQuoteInput): Promise<QuoteDetail> {
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

    const siteInstances: SiteInstance[] = loaded.map(({ i, detail }) => ({
      instanceId: i.instanceId,
      release: detail.body as ProductModelRelease,
      input: i.input as ConfigInput,
      ...(i.overrides !== undefined ? { overrides: i.overrides as CascadeLayers } : {}),
    }));

    const result = deriveSite(site, siteInstances, priceTable.table as never, catalog);
    if (!result.isValid) {
      throw new UnprocessableEntityException({
        message: "site did not derive to a valid result",
        code: "site_invalid",
        issues: result.issues,
      });
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
    return toDetail(row);
  }

  /**
   * I3 acceptance: reload the EXACT immutable inputs the stamps point at, re-run
   * the pure engine + renderers with the stamped kerf, and deep-equal every
   * frozen artifact (string-exact money). Order-independent comparison
   * (`isDeepStrictEqual`) because JSONB does not preserve object key order.
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
    const catalog = await this.catalogVersions.loadCatalog(stamps.catalogVersion);
    if (!catalog) mismatches.push(`catalog@${stamps.catalogVersion}:missing`);
    const priceTable = await this.priceTables.loadByVersion(scope, stamps.priceTableVersion);
    if (!priceTable) mismatches.push(`priceTable@${stamps.priceTableVersion}:missing`);

    if (mismatches.length > 0) return { quoteId, reproduced: false, mismatches };

    // Re-run the SAME pure path against the stamped immutable inputs (I3).
    const result = deriveSite(snapshot.site, siteInstances, priceTable!.table as never, catalog!);
    if (!result.isValid)
      return { quoteId, reproduced: false, mismatches: ["re-derivation:invalid"] };
    const fresh = artifactsOf(result, snapshot.site, snapshot.cutOptions.kerfMm);

    for (const key of ["bom", "totals", "money", "cutList", "drawings"] as const) {
      if (!isDeepStrictEqual(fresh[key], snapshot[key])) mismatches.push(key);
    }
    // Stamps must re-derive identically too (release pins + versions).
    if (!isDeepStrictEqual(result.stamps, stamps)) mismatches.push("stamps");

    return { quoteId, reproduced: mismatches.length === 0, mismatches };
  }
}
