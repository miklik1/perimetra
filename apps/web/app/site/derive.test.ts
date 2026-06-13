import { describe, expect, it } from "vitest";

import { deriveSiteForUi, issuesByConnection, portsCompatible } from "./derive";
import { initialInstances, initialSite } from "./initial";

/**
 * The site-canvas compute proof (step 6 slice 2): the seeded three-instance
 * project reproduces the golden aggregate (delta-0 lineage reaching the canvas's
 * one compute path), shared posts count once (I6), an over-steep terrain step
 * surfaces a typed connection issue without partial output (I5) yet leaves the
 * plan footprints intact so editing never dead-ends, and only mutually
 * compatible, free ports are offered for connection (I7).
 */
describe("site canvas derive", () => {
  it("derives the golden three-instance aggregate (delta-0 at site scope)", () => {
    const d = deriveSiteForUi(initialSite(), initialInstances());
    expect(d.result.isValid).toBe(true);
    expect(d.result.money.total).toBe("129891.504");
    expect(d.instances).toHaveLength(3);
    // The multi-instance 3D scene renders all three; every instance is outlined.
    expect(d.scene?.instances).toHaveLength(3);
    expect(d.instances.every((i) => i.footprint !== undefined)).toBe(true);
    expect(d.result.sharing.length).toBeGreaterThan(0);
  });

  it("counts shared posts once (I6): removing the fence joint restores a post", () => {
    const site = initialSite();
    const instances = initialInstances();
    // Drop connection 1 (fenceA—fenceB): fenceB's start post is no longer
    // consumed, so the aggregate goes up by exactly one fence post.
    const unjoined = { ...site, connections: site.connections.filter((_, i) => i !== 1) };
    const d = deriveSiteForUi(unjoined, instances);
    expect(d.result.isValid).toBe(true);
    expect(d.result.money.total).toBe("130241.504");
  });

  it("surfaces a connection issue and keeps footprints when a terrain step is too steep (I5)", () => {
    const site = initialSite();
    const tooSteep = {
      ...site,
      terrain: site.terrain.map((s) => (s.id === "s2" ? { ...s, elevation_mm: 400 } : s)),
    };
    const d = deriveSiteForUi(tooSteep, initialInstances());
    expect(d.result.isValid).toBe(false);
    expect(d.scene).toBeUndefined();
    expect(d.result.issues.some((i) => i.severity === "error")).toBe(true);
    // Editing survives: each instance still derives a footprint to drag/fix.
    expect(d.instances.every((i) => i.footprint !== undefined)).toBe(true);
    // The failing connection is attributable, and the canvas marks it invalid.
    expect(issuesByConnection(d.result.issues).size).toBeGreaterThan(0);
    expect(d.connections.some((c) => !c.valid)).toBe(true);
  });

  it("forms a connection from scratch and resolves its plan endpoints", () => {
    const noConn = { ...initialSite(), connections: [] };
    const instances = initialInstances();
    const before = deriveSiteForUi(noConn, instances);
    expect(before.connections).toHaveLength(0);
    expect(before.result.sharing).toHaveLength(0);
    const gateRightFree = before.instances
      .find((i) => i.instanceId === "gate")!
      .ports.find((p) => p.portId === "right")!;
    expect(gateRightFree.used).toBe(false);

    const connected = {
      ...noConn,
      connections: [
        {
          a: { instanceId: "gate", portId: "right" },
          b: { instanceId: "fenceA", portId: "start" },
        },
      ],
    };
    const d = deriveSiteForUi(connected, instances);
    expect(d.connections).toHaveLength(1);
    expect(d.connections[0]!.valid).toBe(true);
    expect(Number.isFinite(d.connections[0]!.from.x)).toBe(true);
    expect(Number.isFinite(d.connections[0]!.to.y)).toBe(true);
    // The connection resolved sharing (fenceA's consumer post dropped, I6) and
    // both ends are now marked used (I7).
    expect(d.result.sharing.length).toBeGreaterThan(0);
    expect(
      d.instances.find((i) => i.instanceId === "gate")!.ports.find((p) => p.portId === "right")!
        .used,
    ).toBe(true);
  });

  it("rotates port anchors with the pose (arc-minute transform, I10)", () => {
    const base = deriveSiteForUi(initialSite(), initialInstances());
    const flat = base.instances.find((i) => i.instanceId === "fenceA")!;
    const flatStart = flat.ports.find((p) => p.portId === "start")!.at!;
    const flatEnd = flat.ports.find((p) => p.portId === "end")!.at!;
    const runLength = Math.round(Math.hypot(flatEnd.x - flatStart.x, flatEnd.y - flatStart.y));
    // Flat: the run lies along plan-x (the two end anchors share a plan-y).
    expect(Math.round(flatEnd.y - flatStart.y)).toBe(0);

    const rotated = initialSite();
    rotated.placements = rotated.placements.map((p) =>
      p.instanceId === "fenceA" ? { ...p, pose: { ...p.pose, rotationArcMin: 5400 } } : p,
    );
    const turned = deriveSiteForUi(rotated, initialInstances()).instances.find(
      (i) => i.instanceId === "fenceA",
    )!;
    const start = turned.ports.find((p) => p.portId === "start")!.at!;
    const end = turned.ports.find((p) => p.portId === "end")!.at!;
    // After a quarter turn the run points along plan-y (x unchanged), length kept.
    expect(Math.round(end.x - start.x)).toBe(0);
    expect(Math.round(Math.hypot(end.x - start.x, end.y - start.y))).toBe(runLength);
  });

  it("offers only mutually-compatible ports and marks used ones (I7)", () => {
    const d = deriveSiteForUi(initialSite(), initialInstances());
    const gate = d.instances.find((i) => i.instanceId === "gate")!;
    const fenceA = d.instances.find((i) => i.instanceId === "fenceA")!;
    const gateRight = gate.ports.find((p) => p.portId === "right")!;
    const gateLeft = gate.ports.find((p) => p.portId === "left")!;
    const fenceStart = fenceA.ports.find((p) => p.portId === "start")!;

    expect(portsCompatible(gateRight, fenceStart)).toBe(true);
    // Two gate sides are not compatible with each other.
    expect(portsCompatible(gateRight, gateLeft)).toBe(false);
    // gate.right and fenceA.start are joined in the seed; gate.left is free.
    expect(gateRight.used).toBe(true);
    expect(gateLeft.used).toBe(false);
    // Anchors resolved → handles have a plan position.
    expect(gateRight.at).toBeDefined();
  });
});
