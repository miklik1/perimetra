/**
 * Site-graph composition (CORE_SPEC §5, step 4) — instances + terrain +
 * connections compose into the one site result every output derives from
 * (I4). Nothing here assumes one instance per project (I11): a single gate is
 * a site with one placement, and its aggregate equals its instance result.
 *
 * The pipeline, in order, stopping at the first errored stage (I5 — no
 * partial site BOM ever ships):
 *
 *   1. structural validation — placements, terrain refs, ports exist, port
 *      kinds MUTUALLY compatible, each port in at most one connection,
 *      sharing declarations resolvable (site-shaped input → typed Issues)
 *   2. terrain injection — a placement's segment elevation is written into
 *      the release's declared elevation parameter THROUGH the ordinary input
 *      gate (one write path, I7); a conflicting explicit input is an error,
 *      never silently out-voted
 *   3. per-instance derivation — the step-1..3 pipeline, unchanged, with
 *      per-instance cascade layers
 *   4. connection constraints — each connected end's `scope: "connection"`
 *      constraints evaluate against a paired scope (`self.*` / `other.*`,
 *      price.* excluded) via the swappable evaluator
 *   5. sharing resolution (I6) — a `consumer` port's element is dropped from
 *      aggregation (the post between two fence fields has exactly one owner);
 *      unconnected consumer ports keep their element (a standalone run still
 *      has both posts)
 *   6. aggregation — surviving parts merge into BOM lines by (component,
 *      unit, category) with per-instance provenance; totals re-sum from the
 *      surviving parts and cross the I10 money boundary as decimal strings
 *
 * Addressing (I9): site-level artifacts are `<instanceId>/<partPath>` — the
 * instanceId is the site author's stable name, never an array position.
 */
import {
  DEFAULT_ROUNDING_POLICY,
  roundMoney,
  type BomCategory,
  type BomUnit,
  type Catalog,
  type MoneyString,
  type PortDef,
  type ProductModelRelease,
  type RoundingPolicy,
  type Scope,
  type Site,
  type Value,
} from "@repo/model";

import type { CascadeLayers } from "./cascade.js";
import { forwardChecker, type ConstraintEvaluator } from "./constraints.js";
import { sumByCategory, sumCostByCategory, toMoneyTotals } from "./emit.js";
import { deriveInstanceDetailed, type DeriveOptions } from "./pipeline.js";
import type {
  CategoryTotals,
  ConfigInput,
  CostTable,
  DerivationResult,
  Issue,
  MoneyTotals,
  Part,
  PriceTable,
} from "./types.js";

/** One configured instance as the caller's storage hands it over. */
export interface SiteInstance {
  /** The site-stable name placements/connections address (I9). */
  instanceId: string;
  release: ProductModelRelease;
  input: ConfigInput;
  /** Cascade layers 3–5 for THIS instance (CORE_SPEC §4). */
  overrides?: CascadeLayers;
}

export interface SiteDeriveOptions {
  /** Swap the constraint evaluator (defaults to the forward checker). */
  constraintEvaluator?: ConstraintEvaluator;
  /** Cost-of-goods layer (ADR 0059) — applied to every instance; the site
   *  result then carries `costTotals`/`costMoney` over the SHARED parts (I6). */
  costs?: CostTable;
  /** Commercial rounding policy (ADR 0081) — applied to every per-line and
   *  rolled-up money figure (haléř). Threaded from the price table; defaults to
   *  {@link DEFAULT_ROUNDING_POLICY}. */
  rounding?: RoundingPolicy;
}

/** A resolved shared element (I6): the consumer's part is not counted; the
 *  owner's part is the one physical element both instances reference. */
export interface ResolvedSharing {
  /** Index into site.connections (the connection's stable input position). */
  connection: number;
  ownerInstanceId: string;
  /** The owner port's declared element — the part that stands. */
  ownerPartPath: string;
  consumerInstanceId: string;
  /** The consumer port's declared element — dropped from aggregation. */
  consumedPartPath: string;
}

/** An aggregate BOM line: same (component, unit, category) merged across
 *  instances, quantities and prices summed, provenance retained. */
export interface SiteBomLine {
  componentCode: string;
  name: string;
  unit: BomUnit;
  category: BomCategory;
  quantity: number;
  /** Internal numeric sum used for aggregation; cross the I10 boundary via
   *  `totalPriceMoney` for any display/serialisation, never this float. */
  totalPrice: number;
  /** Decimal-as-string mirror of `totalPrice` — the boundary representation
   *  (I10), canonicalised the same way as `SiteResult.money`. */
  totalPriceMoney: MoneyString;
  /** Every surviving part folded into this line (I9 site addresses). */
  sources: { instanceId: string; path: string }[];
}

/** What the site derivation ran against (I3) — per-instance release pins, the
 *  catalog version EACH release derived against (per-release catalog, ADR 0065),
 *  the shared price version and every applied override, in order. */
export interface SiteStamps {
  releaseIds: Record<string, string>;
  /** releaseId → the catalog version that release's parts resolved against.
   *  Per-release because two products can pin different catalog versions in one
   *  site; recorded from the catalog actually used, never a claimed number. */
  catalogVersions: Record<string, number>;
  priceTableVersion: number;
  overrideIds: string[];
}

export interface SiteResult {
  /** True only when every instance derived valid AND the site itself raised
   *  no error (structure + connection constraints). */
  isValid: boolean;
  /** Per-instance results, keyed by instanceId; instance-shaped issues live
   *  inside these, site-shaped issues on `issues` below. */
  instances: Record<string, DerivationResult>;
  sharing: ResolvedSharing[];
  bom: SiteBomLine[];
  totals: CategoryTotals;
  /** Decimal-as-string mirror of `totals` — the boundary representation (I10). */
  money: MoneyTotals;
  /** Cost-of-goods totals over the shared parts — present only when a cost
   *  table was supplied (ADR 0059). Shares are costed once, like the price. */
  costTotals?: CategoryTotals;
  /** Decimal-as-string mirror of {@link costTotals} (I10). */
  costMoney?: MoneyTotals;
  /** Site-level issues only (structure, terrain, connection constraints). */
  issues: Issue[];
  stamps: SiteStamps;
}

const issue = (key: string, params?: Record<string, Value>): Issue => ({
  key,
  severity: "error",
  scope: "site",
  ...(params !== undefined && { params }),
});

interface ConnectionEndView {
  instanceId: string;
  release: ProductModelRelease;
  port: PortDef;
}

type ValidConnection = { a: ConnectionEndView; b: ConnectionEndView } | undefined;

/** Prefix an instance's evaluation scope into one side of a pair scope.
 *  price.* is excluded — connection constraints are geometric/structural,
 *  never commercial. */
function prefixScope(into: Scope, prefix: string, scope: Scope): void {
  for (const [key, value] of Object.entries(scope)) {
    if (key.startsWith("price.")) continue;
    into[`${prefix}.${key}`] = value;
  }
}

/** A site roster release whose catalog the caller did not supply in the catalog
 *  map (keyed by releaseId, deduped by reference across shared versions). An
 *  AUTHOR-time throw — the API/web assemble a complete map — and the structural
 *  I5 backstop that replaces the old single-catalog de-dupe guards (ADR 0065). */
export class MissingCatalogError extends Error {
  constructor(readonly releaseId: string) {
    super(`No catalog supplied for release "${releaseId}"`);
    this.name = "MissingCatalogError";
  }
}

/** The catalog a release resolves against — each instance derives against its
 *  own pinned version, so two products on different catalog versions coexist in
 *  one site (ADR 0065). */
function catalogFor(release: ProductModelRelease, catalogs: ReadonlyMap<string, Catalog>): Catalog {
  const catalog = catalogs.get(release.id);
  if (catalog === undefined) throw new MissingCatalogError(release.id);
  return catalog;
}

export function deriveSite(
  site: Site,
  instances: SiteInstance[],
  prices: PriceTable,
  /** releaseId → catalog (per-release catalog, ADR 0065). Distinct releases on
   *  the same version may share one Catalog object reference (deduped upstream);
   *  every roster release must have an entry or {@link MissingCatalogError}. */
  catalogs: ReadonlyMap<string, Catalog>,
  options: SiteDeriveOptions = {},
): SiteResult {
  const evaluator = options.constraintEvaluator ?? forwardChecker;
  const policy = options.rounding ?? DEFAULT_ROUNDING_POLICY;
  const issues: Issue[] = [];
  const instanceResults: Record<string, DerivationResult> = {};

  // --- Instance roster ---------------------------------------------------------
  const byId = new Map<string, SiteInstance>();
  for (const instance of instances) {
    if (byId.has(instance.instanceId)) {
      issues.push(issue("engine.site.duplicate_instance", { id: instance.instanceId }));
      continue;
    }
    byId.set(instance.instanceId, instance);
  }

  const stamps: SiteStamps = {
    releaseIds: Object.fromEntries([...byId.values()].map((i) => [i.instanceId, i.release.id])),
    // Read from the catalog each release ACTUALLY used (never a claimed number);
    // throws MissingCatalogError now if the map is incomplete — the structural
    // I5 backstop, before any work.
    catalogVersions: Object.fromEntries(
      [...byId.values()].map((i) => [i.release.id, catalogFor(i.release, catalogs).version]),
    ),
    priceTableVersion: prices.version,
    overrideIds: [],
  };

  const invalid = (): SiteResult => {
    const totals = { material: 0, accessory: 0, manufacturing: 0, installation: 0, total: 0 };
    return {
      isValid: false,
      instances: instanceResults,
      sharing: [],
      bom: [],
      totals,
      money: toMoneyTotals(totals, policy),
      issues,
      stamps,
    };
  };

  // --- Placements & terrain ------------------------------------------------------
  const segments = new Map<string, number>();
  for (const segment of site.terrain) {
    if (segments.has(segment.id)) {
      issues.push(issue("engine.site.duplicate_terrain_segment", { id: segment.id }));
      continue;
    }
    segments.set(segment.id, segment.elevation_mm);
  }

  /** instanceId → elevation to inject (only placements on a segment). */
  const elevations = new Map<string, number>();
  const placed = new Set<string>();
  for (const placement of site.placements) {
    if (!byId.has(placement.instanceId)) {
      issues.push(issue("engine.site.unknown_instance", { id: placement.instanceId }));
      continue;
    }
    if (placed.has(placement.instanceId)) {
      issues.push(issue("engine.site.duplicate_placement", { id: placement.instanceId }));
      continue;
    }
    placed.add(placement.instanceId);

    if (placement.terrainSegmentId === undefined) continue;
    const elevation = segments.get(placement.terrainSegmentId);
    if (elevation === undefined) {
      issues.push(
        issue("engine.site.unknown_terrain_segment", {
          id: placement.instanceId,
          segment: placement.terrainSegmentId,
        }),
      );
      continue;
    }
    if (byId.get(placement.instanceId)!.release.terrain === undefined) {
      // The site asserted terrain-following for a model that cannot follow —
      // surfacing beats silently ignoring the placement's segment (I5).
      issues.push(
        issue("engine.site.terrain_unbound", {
          id: placement.instanceId,
          segment: placement.terrainSegmentId,
        }),
      );
      continue;
    }
    elevations.set(placement.instanceId, elevation);
  }
  for (const instance of byId.values()) {
    if (!placed.has(instance.instanceId)) {
      issues.push(issue("engine.site.unplaced_instance", { id: instance.instanceId }));
    }
  }

  // --- Connections: ports exist, used once, kinds mutually compatible ------------
  const usedPorts = new Set<string>();
  const connections: ValidConnection[] = site.connections.map((connection, index) => {
    const ends: ConnectionEndView[] = [];
    for (const end of [connection.a, connection.b]) {
      const instance = byId.get(end.instanceId);
      if (instance === undefined) {
        issues.push(issue("engine.site.unknown_instance", { id: end.instanceId }));
        continue;
      }
      const port = (instance.release.ports ?? []).find((p) => p.id === end.portId);
      if (port === undefined) {
        issues.push(issue("engine.site.unknown_port", { id: end.instanceId, port: end.portId }));
        continue;
      }
      const portKey = `${end.instanceId}#${end.portId}`;
      if (usedPorts.has(portKey)) {
        // One physical connection point joins one neighbor — a reused port is
        // a site-modeling error, not a fan-out.
        issues.push(issue("engine.site.port_reused", { id: end.instanceId, port: end.portId }));
        continue;
      }
      usedPorts.add(portKey);
      ends.push({ instanceId: end.instanceId, release: instance.release, port });
    }
    if (ends.length !== 2) return undefined;
    const [a, b] = ends as [ConnectionEndView, ConnectionEndView];

    const mutual =
      a.port.compatibleKinds.includes(b.port.kind) && b.port.compatibleKinds.includes(a.port.kind);
    if (!mutual) {
      issues.push(
        issue("engine.site.port_incompatible", {
          connection: index,
          aKind: a.port.kind,
          bKind: b.port.kind,
        }),
      );
      return undefined;
    }

    const aConsumes = a.port.sharing?.policy === "consumer";
    const bConsumes = b.port.sharing?.policy === "consumer";
    if (aConsumes && bConsumes) {
      // Nobody provides the element both sides expect to attach to.
      issues.push(issue("engine.site.sharing_conflict", { connection: index }));
      return undefined;
    }
    if (
      (aConsumes && b.port.sharing === undefined) ||
      (bConsumes && a.port.sharing === undefined)
    ) {
      issues.push(issue("engine.site.sharing_unprovided", { connection: index }));
      return undefined;
    }
    return { a, b };
  });

  // --- Per-instance derivation (terrain elevation through the input gate) --------
  const instanceScopes = new Map<string, Scope>();
  let allInstancesValid = true;
  for (const instance of byId.values()) {
    let input = instance.input;
    const elevation = elevations.get(instance.instanceId);
    if (elevation !== undefined) {
      const key = instance.release.terrain!.elevationParam;
      const explicit = input[key];
      if (explicit !== undefined && explicit !== elevation) {
        // The placement says one height, the config another — surface, never
        // let one silently out-vote the other (I5).
        issues.push(
          issue("engine.site.elevation_conflict", {
            id: instance.instanceId,
            param: key,
            input: explicit,
            terrain: elevation,
          }),
        );
        allInstancesValid = false;
        continue;
      }
      input = { ...input, [key]: elevation };
    }

    const instanceOptions: DeriveOptions = {
      ...(options.constraintEvaluator !== undefined && {
        constraintEvaluator: options.constraintEvaluator,
      }),
      ...(instance.overrides !== undefined && { overrides: instance.overrides }),
      ...(options.costs !== undefined && { costs: options.costs }),
      rounding: policy,
    };
    const { result, scope } = deriveInstanceDetailed(
      instance.release,
      input,
      prices,
      catalogFor(instance.release, catalogs),
      instanceOptions,
    );
    instanceResults[instance.instanceId] = result;
    stamps.overrideIds.push(...result.stamps.overrideIds);
    if (!result.isValid || scope === undefined) {
      allInstancesValid = false;
      continue;
    }
    instanceScopes.set(instance.instanceId, scope);
  }

  if (!allInstancesValid || issues.some((i) => i.severity === "error")) return invalid();

  // --- Connection constraints (both ends, paired self/other scopes) --------------
  connections.forEach((ends, index) => {
    if (ends === undefined) return;
    for (const [self, other] of [
      [ends.a, ends.b],
      [ends.b, ends.a],
    ] as const) {
      const pairScope: Scope = {};
      prefixScope(pairScope, "self", instanceScopes.get(self.instanceId)!);
      prefixScope(pairScope, "other", instanceScopes.get(other.instanceId)!);
      for (const raised of evaluator.evaluateConnection(self.release, pairScope)) {
        issues.push({
          ...raised,
          params: {
            ...raised.params,
            connection: index,
            self: self.instanceId,
            other: other.instanceId,
          },
        });
      }
    }
  });

  if (issues.some((i) => i.severity === "error")) return invalid();

  // --- Sharing resolution (I6) ----------------------------------------------------
  const sharing: ResolvedSharing[] = [];
  const consumed = new Set<string>();
  connections.forEach((ends, index) => {
    if (ends === undefined) return;
    for (const [end, opposite] of [
      [ends.a, ends.b],
      [ends.b, ends.a],
    ] as const) {
      if (end.port.sharing?.policy !== "consumer") continue;
      // Structural validation guaranteed the opposite port declares an element.
      sharing.push({
        connection: index,
        ownerInstanceId: opposite.instanceId,
        ownerPartPath: opposite.port.sharing!.element,
        consumerInstanceId: end.instanceId,
        consumedPartPath: end.port.sharing.element,
      });
      consumed.add(`${end.instanceId}/${end.port.sharing.element}`);
    }
  });

  // --- Aggregation (dedupe by ownership, merge by component) ----------------------
  const surviving: Part[] = [];
  const lines = new Map<string, Omit<SiteBomLine, "totalPriceMoney">>();
  for (const instance of byId.values()) {
    for (const part of instanceResults[instance.instanceId]!.parts) {
      if (consumed.has(`${instance.instanceId}/${part.path}`)) continue;
      surviving.push(part);
      const key = `${part.componentCode}|${part.unit}|${part.category}`;
      const line = lines.get(key);
      if (line === undefined) {
        lines.set(key, {
          componentCode: part.componentCode,
          name: part.name,
          unit: part.unit,
          category: part.category,
          quantity: part.quantity,
          // sumByCategory below guarantees every surviving part is priced (I5).
          totalPrice: part.totalPrice ?? 0,
          sources: [{ instanceId: instance.instanceId, path: part.path }],
        });
      } else {
        line.quantity += part.quantity;
        line.totalPrice += part.totalPrice ?? 0;
        line.sources.push({ instanceId: instance.instanceId, path: part.path });
      }
    }
  }

  const totals = sumByCategory(surviving);
  // Cost rides the SAME surviving (post-sharing) parts, so shared elements are
  // costed once — exactly like the price total (ADR 0059, I6).
  const costTotals = options.costs ? sumCostByCategory(surviving) : undefined;

  return {
    isValid: true,
    instances: instanceResults,
    sharing,
    // Cross the I10 money boundary once per line (decimal string), exactly as
    // the category totals do — no per-line float ever leaves the engine.
    bom: [...lines.values()].map((line) => ({
      ...line,
      totalPriceMoney: roundMoney(line.totalPrice, policy),
    })),
    totals,
    money: toMoneyTotals(totals, policy),
    ...(costTotals !== undefined && {
      costTotals,
      costMoney: toMoneyTotals(costTotals, policy),
    }),
    issues,
    stamps,
  };
}
