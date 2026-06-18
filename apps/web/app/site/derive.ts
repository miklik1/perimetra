/**
 * The site canvas's one compute path (CORE_SPEC §8 / step 6 slice 2): the
 * editable Site + its placed instances → engine → (aggregate result, 3D scene,
 * per-instance footprints, connection lines). Pure and synchronous — the engine
 * has no I/O (I1), so the whole site re-derives in the browser per edit, exactly
 * as the single-instance configurator does (this generalises `deriveForUi` from
 * one degenerate instance to the real multi-instance site, I11).
 *
 * Two truths, kept apart so editing never dead-ends:
 *  - the AGGREGATE (BOM/price/3D/plan) comes off the one `deriveSite`, and only
 *    renders when the site is valid (no geometric truth for an invalid site, I5);
 *  - the PER-INSTANCE footprints reuse each instance's already-derived geometry
 *    (`result.instances[id]`) so the plan stays draggable even while a bad
 *    connection or terrain step invalidates the site as a whole.
 */
import {
  deriveInstanceDetailed,
  deriveSite,
  type ConfigInput,
  type DerivationResult,
  type Issue,
  type PriceTable,
  type SiteInstance,
  type SiteResult,
} from "@repo/engine";
import type { Catalog, Scope, Site, SitePlacement } from "@repo/model";
import {
  buildScene,
  buildSitePlan,
  toPlan,
  type Pt,
  type Scene3D,
  type SitePlanInstance,
  type Vec3,
} from "@repo/renderers";

import { type ConfigurableProduct } from "../configurator/products";

/** The api-served catalog context the canvas derives against (ADR 0060):
 *  the published products (indexed roster), each release's catalog keyed by
 *  release id (per-release catalog, ADR 0065 — products may pin different catalog
 *  versions), and the org's active price table. Prop-passed in (the engine
 *  requires a price table, so the canvas only renders when `prices` is present). */
export interface SiteDeriveContext {
  products: ConfigurableProduct[];
  catalogs: ReadonlyMap<string, Catalog>;
  prices: PriceTable;
}

/** One placed instance as the canvas stores it: which release (by product
 *  index into the context's roster) and the user's config input. The
 *  pose/terrain live on the Site's placement, keyed by the same instanceId. */
export interface PlacedInstance {
  instanceId: string;
  productIndex: number;
  input: ConfigInput;
}

/** One connection port resolved for the canvas: its kind (for compatibility),
 *  its plan position (when the instance derived an anchor for it), and whether
 *  it is already taken by a connection (a port joins one neighbour). */
export interface PortUi {
  portId: string;
  kind: string;
  compatibleKinds: string[];
  at?: Pt;
  used: boolean;
}

/** Everything the canvas needs to draw one instance: its product, its derived
 *  result (from the site composition), its plan footprint, and its ports. */
export interface InstanceUi {
  instanceId: string;
  product: ConfigurableProduct;
  placement: SitePlacement;
  /** The instance's result within the site composition; absent when the engine
   *  skipped its derivation (e.g. an elevation conflict) — the site panel still
   *  surfaces that as a typed site issue (I5). */
  result?: DerivationResult;
  /** Top-view outline at the instance's pose; absent when the instance's own
   *  config is invalid (it has no geometry to outline — I5). */
  footprint?: SitePlanInstance;
  /** Port anchors keyed by portId, instance-local assembly space. */
  anchors: Record<string, Vec3>;
  ports: PortUi[];
}

/** A connection resolved to two plan points for the canvas to draw. `valid`
 *  drives the colour: a connection that raised an error renders as a warning. */
export interface PlanConnection {
  index: number;
  from: Pt;
  to: Pt;
  valid: boolean;
  /** The one owned shared element (I6), when the engine resolved sharing. */
  shared?: { ownerInstanceId: string; partPath: string };
}

export interface SiteUiDerivation {
  result: SiteResult;
  instances: InstanceUi[];
  connections: PlanConnection[];
  /** Present only for a valid site — the multi-instance 3D scene (I4/I5). */
  scene?: Scene3D;
}

export const releaseOf = (ctx: SiteDeriveContext, i: PlacedInstance) =>
  ctx.products[i.productIndex]!.release;

/** The catalog a placed instance derives against — its release's own pinned
 *  catalog (per-release catalog, ADR 0065). The bundle always includes it; a miss
 *  is a bundle-assembly bug surfaced loudly (mirrors the engine's
 *  MissingCatalogError), never a silent wrong-catalog derivation (I5). */
function catalogOf(ctx: SiteDeriveContext, i: PlacedInstance): Catalog {
  const release = releaseOf(ctx, i);
  const catalog = ctx.catalogs.get(release.id);
  if (catalog === undefined) {
    throw new Error(`No catalog for release "${release.id}" in the bundle`);
  }
  return catalog;
}

/** Map the canvas's placed instances to the engine's SiteInstance roster. */
function siteInstances(ctx: SiteDeriveContext, placed: PlacedInstance[]): SiteInstance[] {
  return placed.map((p) => ({
    instanceId: p.instanceId,
    release: releaseOf(ctx, p),
    input: p.input,
  }));
}

/** Inject a placement's terrain-segment elevation into the release's declared
 *  elevation parameter — the same one write path the engine uses (I7), so the
 *  selected instance's wizard scope matches what the site composes. Best-effort
 *  for display: a genuine conflict is surfaced authoritatively on the site
 *  result, so here the terrain value simply wins for the form's scope. */
function terrainInput(ctx: SiteDeriveContext, site: Site, instance: PlacedInstance): ConfigInput {
  const placement = site.placements.find((p) => p.instanceId === instance.instanceId);
  const release = releaseOf(ctx, instance);
  if (placement?.terrainSegmentId === undefined || release.terrain === undefined) {
    return instance.input;
  }
  const segment = site.terrain.find((s) => s.id === placement.terrainSegmentId);
  if (segment === undefined) return instance.input;
  return { ...instance.input, [release.terrain.elevationParam]: segment.elevation_mm };
}

/** The selected instance's form scope (params + option attrs + derived) — what
 *  `relevance` and effective-value badges read. Computed on demand for the one
 *  instance whose wizard is open, terrain-injected to match the site. */
export function deriveInstanceScope(
  ctx: SiteDeriveContext,
  site: Site,
  instance: PlacedInstance,
): { result: DerivationResult; scope?: Scope } {
  const { result, scope } = deriveInstanceDetailed(
    releaseOf(ctx, instance),
    terrainInput(ctx, site, instance),
    ctx.prices,
    catalogOf(ctx, instance),
  );
  return { result, ...(scope && { scope }) };
}

/** Plan point of an instance-local anchor under a placement pose, via the
 *  renderer's own `toPlan` (the single plan-coordinate transform, I4) — reused
 *  here for connection handles drawn off engine-derived anchors. */
function anchorToPlan(anchor: Vec3, placement: SitePlacement): Pt {
  return toPlan(anchor, {
    origin: { x: placement.pose.origin_mm.x, y: placement.pose.origin_mm.y },
    rotationArcMin: placement.pose.rotationArcMin ?? 0,
  });
}

/** A single instance's footprint, reusing its already-derived geometry from the
 *  site result (no re-derivation): wrap the one instance result in a degenerate
 *  one-placement site so the renderer outlines it in isolation, unaffected by a
 *  site-level (connection/terrain) failure. Returns undefined if the instance's
 *  own config is invalid. */
function footprintFor(
  site: Site,
  result: SiteResult,
  placement: SitePlacement,
): SitePlanInstance | undefined {
  const instanceResult = result.instances[placement.instanceId];
  if (instanceResult === undefined || !instanceResult.isValid) return undefined;
  const soloSite: Site = {
    id: `${site.id}:${placement.instanceId}`,
    terrain: [],
    placements: [{ instanceId: placement.instanceId, pose: placement.pose }],
    connections: [],
  };
  // Reuse the site result's (zeroed) aggregate fields; only `instances` and a
  // true `isValid` matter to the plan renderer for one isolated outline.
  const solo: SiteResult = {
    ...result,
    isValid: true,
    instances: { [placement.instanceId]: instanceResult },
    sharing: [],
    bom: [],
  };
  return buildSitePlan(soloSite, solo).instances[0];
}

export function deriveSiteForUi(
  ctx: SiteDeriveContext,
  site: Site,
  placed: PlacedInstance[],
): SiteUiDerivation {
  const result = deriveSite(site, siteInstances(ctx, placed), ctx.prices, ctx.catalogs);

  const placementOf = new Map(site.placements.map((p) => [p.instanceId, p]));
  const usedPorts = new Set(
    site.connections.flatMap((c) => [
      `${c.a.instanceId}#${c.a.portId}`,
      `${c.b.instanceId}#${c.b.portId}`,
    ]),
  );
  const instances: InstanceUi[] = placed
    .filter((p) => placementOf.has(p.instanceId))
    .map((p) => {
      const placement = placementOf.get(p.instanceId)!;
      const instanceResult = result.instances[p.instanceId];
      const anchors = instanceResult?.anchors ?? {};
      const ports: PortUi[] = (releaseOf(ctx, p).ports ?? []).map((port) => {
        const anchor = anchors[port.id];
        return {
          portId: port.id,
          kind: port.kind,
          compatibleKinds: port.compatibleKinds,
          ...(anchor !== undefined && { at: anchorToPlan(anchor, placement) }),
          used: usedPorts.has(`${p.instanceId}#${port.id}`),
        };
      });
      return {
        instanceId: p.instanceId,
        product: ctx.products[p.productIndex]!,
        placement,
        ...(instanceResult !== undefined && { result: instanceResult }),
        footprint: footprintFor(site, result, placement),
        anchors,
        ports,
      };
    });

  const footprintById = new Map(instances.map((i) => [i.instanceId, i]));
  const issueConnections = new Set(
    result.issues
      .map((i) => i.params?.["connection"])
      .filter((c): c is number => typeof c === "number"),
  );

  const connections: PlanConnection[] = site.connections.map((connection, index) => {
    const endpoint = (end: { instanceId: string; portId: string }): Pt => {
      const ui = footprintById.get(end.instanceId);
      const anchor = ui?.anchors[end.portId];
      if (anchor !== undefined && ui !== undefined) return anchorToPlan(anchor, ui.placement);
      // Fallback for a not-yet-derivable end: the footprint centroid, else the
      // raw pose origin — enough to draw a line so the user can fix/remove it.
      if (ui?.footprint !== undefined) return ui.footprint.labelAt;
      const placement = placementOf.get(end.instanceId);
      return placement
        ? { x: placement.pose.origin_mm.x, y: placement.pose.origin_mm.y }
        : { x: 0, y: 0 };
    };
    const shared = result.sharing.find((s) => s.connection === index);
    return {
      index,
      from: endpoint(connection.a),
      to: endpoint(connection.b),
      valid: !issueConnections.has(index),
      ...(shared !== undefined && {
        shared: { ownerInstanceId: shared.ownerInstanceId, partPath: shared.ownerPartPath },
      }),
    };
  });

  return {
    result,
    instances,
    connections,
    ...(result.isValid && { scene: buildScene(site, result) }),
  };
}

/** Two ports may connect when each lists the other's kind (the engine's mutual
 *  compatibility rule, I7) — used to offer only valid targets while connecting,
 *  so the canvas never lets the user build a structurally-rejected connection. */
export function portsCompatible(a: PortUi, b: PortUi): boolean {
  return a.compatibleKinds.includes(b.kind) && b.compatibleKinds.includes(a.kind);
}

/** Site-level issues carry a `connection` param when they pertain to one edge;
 *  group them so the canvas/panel can attribute a failure to its connection. */
export function issuesByConnection(issues: Issue[]): Map<number, Issue[]> {
  const map = new Map<number, Issue[]>();
  for (const issue of issues) {
    const index = issue.params?.["connection"];
    if (typeof index !== "number") continue;
    const list = map.get(index) ?? [];
    list.push(issue);
    map.set(index, list);
  }
  return map;
}
