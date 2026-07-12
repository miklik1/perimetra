/**
 * Geometry-POSITION golden for `swing-gate@1` (ADR 0095 pattern).
 *
 * The delta-0 corpus locks BOM/price; NOTHING there pins WHERE the 3D pieces
 * actually SIT — so an internally consistent but physically wrong member (a stile
 * floating off the top, a leaf sunk below ground, the two leaves overlapping)
 * would ship green and only surface on a human looking at the render. This is the
 * missing guard: it asserts the assembled scene's envelope (no leaf piece rises
 * above the clear height), that the hinge posts are grounded + vertical, that the
 * two leaves sit side-by-side with the astragal between them, that the frame
 * rails cap the leaf crowns, and that nothing sinks below the floor.
 *
 * Per the repo's verify-3d-render-eyes-on rule this math-only golden is backed by
 * an actual /scene-lab render capture — geometry is never called correct from
 * the assertions alone.
 */
import { describe, expect, it } from "vitest";

import { deriveSite } from "@repo/engine";
import type { Catalog, Site } from "@repo/model";
import { add, buildScene, rotate, type ScenePiece, type Vec3 } from "@repo/renderers";

import { catalogV3 } from "./catalog/catalog-v3.js";
import { planka_120_3d_vzor } from "./golden/swing-gate.js";
import { swingGateV1 } from "./releases/swing-gate.js";

const PREVIEW = "preview";

const previewSite: Site = {
  id: "swing-geometry-golden",
  terrain: [],
  placements: [{ instanceId: PREVIEW, pose: { origin_mm: { x: 0, y: 0 } } }],
  connections: [],
};

function scenePieces() {
  const catalogs: ReadonlyMap<string, Catalog> = new Map([[swingGateV1.id, catalogV3]]);
  const result = deriveSite(
    previewSite,
    [{ instanceId: PREVIEW, release: swingGateV1, input: planka_120_3d_vzor.config }],
    planka_120_3d_vzor.prices,
    catalogs,
  );
  if (!result.isValid) throw new Error("VZOR fixture must derive valid");
  const scene = buildScene(previewSite, result);
  return scene.instances[0]!.pieces.map((p: ScenePiece) => {
    const start: Vec3 = p.at;
    const end: Vec3 = add(p.at, rotate([p.lengthMm, 0, 0], p.rotationArcMin));
    return { id: p.id, start, end };
  });
}

describe("swing-gate@1 geometry positions (ADR 0095)", () => {
  const pieces = scenePieces();
  const groundY = 0;
  const openingWidth = Number(planka_120_3d_vzor.config.opening_width_mm); // 3000
  const clearHeight = Number(planka_120_3d_vzor.config.clear_height_mm); // 1500
  const midX = openingWidth / 2; // 1500
  // Profile half-extent slack: a member centred at a crown reaches a few cm
  // higher. Nothing legitimate clears the opening (the posts are exempt).
  const maxY = groundY + clearHeight + 50;

  it("derives the expected piece set", () => {
    expect(pieces.length).toBeGreaterThan(0);
  });

  it("no leaf piece floats above the clear height (envelope invariant)", () => {
    // Hinge posts are exempt — they legitimately stand a touch taller than the
    // opening (postHeight = clear + 10).
    const leaf = pieces.filter((p) => !p.id.includes("/frame.post/"));
    const offenders = leaf.filter((p) => p.start[1] > maxY || p.end[1] > maxY);
    expect(
      offenders.map(
        (p) => `${p.id} start.y=${Math.round(p.start[1])} end.y=${Math.round(p.end[1])}`,
      ),
    ).toEqual([]);
  });

  it("the two hinge posts are grounded, vertical, at the opening edges", () => {
    const posts = pieces.filter((p) => p.id.includes("/frame.post/"));
    expect(posts).toHaveLength(2);
    for (const post of posts) {
      expect(post.start[1]).toBeLessThan(groundY + 20); // base on the ground
      expect(post.end[1]).toBeGreaterThan(post.start[1] + 1000); // rises tall
      expect(Math.abs(post.end[0] - post.start[0])).toBeLessThan(1); // vertical
    }
    const xs = posts.map((p) => p.start[0]).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(0, 0);
    expect(xs[1]).toBeCloseTo(openingWidth, 0);
  });

  it("the astragal meeting stile is grounded and sits between the two leaves", () => {
    const center = pieces.find((p) => p.id.endsWith("/centerStile"));
    expect(center, "a centre stile exists").toBeDefined();
    expect(center!.start[1]).toBeLessThan(groundY + 20); // reaches the ground (drop-bolt)
    expect(center!.end[1]).toBeGreaterThan(center!.start[1] + 1000); // vertical, tall
    expect(Math.abs(center!.end[0] - center!.start[0])).toBeLessThan(1);
    // It is the meeting stile — near mid-span, between the leaves.
    expect(Math.abs(center!.start[0] - midX)).toBeLessThan(100);
  });

  it("the leaf top rails are horizontal, one per leaf, at the crown line", () => {
    const topRails = pieces.filter((p) => p.id.endsWith("Top"));
    expect(topRails).toHaveLength(2);
    for (const rail of topRails) {
      expect(Math.abs(rail.end[1] - rail.start[1])).toBeLessThan(1); // horizontal
    }
    // One left of centre, one right — the two leaves side by side.
    const leftRail = topRails.find((r) => r.start[0] < midX);
    const rightRail = topRails.find((r) => r.start[0] > midX);
    expect(leftRail, "a left-leaf top rail").toBeDefined();
    expect(rightRail, "a right-leaf top rail").toBeDefined();
    // The vertical stiles' crowns meet the top rail (nothing "floats").
    const stiles = pieces.filter((p) => p.id.includes("/frame.lprofile/stile"));
    expect(stiles.length).toBeGreaterThan(0);
    for (const stile of stiles) {
      expect(stile.end[1]).toBeGreaterThan(stile.start[1]); // rises
      expect(Math.abs(stile.end[1] - leftRail!.start[1])).toBeLessThan(60);
    }
  });

  it("the two divider crossbars are horizontal, one per leaf, above the leaf foot", () => {
    const dividers = pieces.filter((p) => p.id.includes("/frame.tpost/dividerRail["));
    expect(dividers).toHaveLength(2);
    for (const d of dividers) {
      expect(Math.abs(d.end[1] - d.start[1])).toBeLessThan(1); // horizontal
      expect(d.start[1]).toBeGreaterThan(groundY + 200); // above the foot
      expect(d.start[1]).toBeLessThan(maxY); // below the crown
    }
    expect(dividers.some((d) => d.start[0] < midX)).toBe(true);
    expect(dividers.some((d) => d.start[0] > midX)).toBe(true);
  });

  it("every piece sits at or above ground (nothing sinks below the floor)", () => {
    const sunk = pieces.filter((p) => p.start[1] < groundY - 50 || p.end[1] < groundY - 50);
    expect(sunk.map((p) => p.id)).toEqual([]);
  });
});
