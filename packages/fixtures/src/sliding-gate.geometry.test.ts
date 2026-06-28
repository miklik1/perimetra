/**
 * Geometry-POSITION golden for `sliding-gate@1` (ADR 0095).
 *
 * The delta-0 corpus locks BOM/price; the renderer tests lock cut angles +
 * nesting. NOTHING pinned where the 3D pieces actually SIT — so an internally
 * consistent but physically wrong member (the suspension diagonal authored to
 * ASCEND out of the gate into the sky at y≈2530, the 6.5 m Nosník floated as a
 * full-width OVERHEAD beam at y≈1560) shipped fully green and only surfaced on
 * a human looking at the render. This is the missing guard: it asserts the
 * assembled scene's envelope (no piece rises above the clear height — i.e. no
 * piece floats off the top of the gate) and that the cantilever diagonal
 * descends into the leaf. A future authoring slip that lifts a member off the
 * structure fails HERE, in CI, not in the dílna.
 */
import { describe, expect, it } from "vitest";

import { deriveSite } from "@repo/engine";
import type { Catalog, Site } from "@repo/model";
import { add, buildScene, rotate, type ScenePiece, type Vec3 } from "@repo/renderers";

import { catalogV1 } from "./catalog/catalog-v1.js";
import { planka_100_2d_3panel } from "./golden/sliding-gate.js";
import { slidingGateV1 } from "./releases/sliding-gate.js";

const PREVIEW = "preview";

/** The configurator's preview site: one instance at the origin (mirrors
 *  apps/web/app/configurator/derive.ts so this golden tracks what renders). */
const previewSite: Site = {
  id: "geometry-golden",
  terrain: [],
  placements: [{ instanceId: PREVIEW, pose: { origin_mm: { x: 0, y: 0 } } }],
  connections: [],
};

function scenePieces() {
  const catalogs: ReadonlyMap<string, Catalog> = new Map([[slidingGateV1.id, catalogV1]]);
  const result = deriveSite(
    previewSite,
    [{ instanceId: PREVIEW, release: slidingGateV1, input: planka_100_2d_3panel.config }],
    planka_100_2d_3panel.prices,
    catalogs,
  );
  if (!result.isValid) throw new Error("U34 fixture must derive valid");
  const scene = buildScene(previewSite, result);
  const instance = scene.instances[0]!;
  // World endpoints per piece (instance is at the origin, unrotated): the local
  // start `at` and the far end `at + R·[length,0,0]` — the same transform the
  // R3F walker applies (group at `at`, geometry extruded along local +X).
  return instance.pieces.map((p: ScenePiece) => {
    const start: Vec3 = p.at;
    const end: Vec3 = add(p.at, rotate([p.lengthMm, 0, 0], p.rotationArcMin));
    return { id: p.id, start, end };
  });
}

describe("sliding-gate@1 geometry positions (ADR 0095)", () => {
  const pieces = scenePieces();
  const groundY = 0;
  const clearHeight = Number(planka_100_2d_3panel.config.clear_height_mm); // 1500
  // Profile half-extent slack: a member centred at the post crown has its
  // section reaching a few cm higher. Nothing legitimate clears the opening.
  const maxY = groundY + clearHeight + 50;

  it("derives the expected piece set", () => {
    expect(pieces.length).toBeGreaterThan(0);
  });

  it("no leaf piece floats above the clear height (envelope invariant)", () => {
    // Catches BOTH historical bugs: diagonal ascending to ~2530 and the Nosník
    // floated overhead at ~1560 (clear_height + 60). The exterior catch post
    // (tower_post) is exempt — it legitimately stands taller than the opening
    // (it carries the top guide). FLAGGED: its height is authored as
    // clear_height + 400 (=1900) where gates-MVP used clear_height; confirm the
    // real value with FIL in the fidelity pass.
    const leaf = pieces.filter((p) => !p.id.includes("tower_post"));
    const offenders = leaf.filter((p) => p.start[1] > maxY || p.end[1] > maxY);
    expect(
      offenders.map(
        (p) => `${p.id} start.y=${Math.round(p.start[1])} end.y=${Math.round(p.end[1])}`,
      ),
    ).toEqual([]);
  });

  it("the exterior catch post is grounded and vertical (not floating)", () => {
    const post = pieces.find((p) => p.id.includes("tower_post"));
    expect(post, "a catch/tower post exists").toBeDefined();
    expect(post!.start[1]).toBeLessThan(groundY + 50); // base on the ground
    expect(post!.end[1]).toBeGreaterThan(post!.start[1]); // rises
    expect(post!.end[1]).toBeLessThan(groundY + clearHeight + 600); // sane height, not the sky
  });

  it("the cantilever suspension diagonal descends into the leaf to rail level", () => {
    const diagonal = pieces.find((p) => p.id.endsWith("/diagonal"));
    expect(diagonal, "a diagonal piece exists").toBeDefined();
    // It must go DOWN from its post-crown anchor, not up into the sky…
    expect(diagonal!.end[1]).toBeLessThan(diagonal!.start[1]);
    // …and its far end lands near the bottom rail (≈ ground), not overhead.
    expect(diagonal!.end[1]).toBeLessThan(groundY + 200);
  });

  it("every piece sits at or above ground (nothing sinks below the floor)", () => {
    const sunk = pieces.filter((p) => p.start[1] < groundY - 50 || p.end[1] < groundY - 50);
    expect(sunk.map((p) => p.id)).toEqual([]);
  });
});
