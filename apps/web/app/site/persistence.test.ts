import { describe, expect, it } from "vitest";

import type { ProjectInstanceInput } from "@repo/validators";

import { appendInstanceToDocument, emptySite, PLACE_SPACING_MM } from "./persistence";

/**
 * `appendInstanceToDocument` (CAR-13, configurator → project hand-off): the
 * pure helper that appends one (releaseId, input) instance to a project's
 * site document — the fresh-project path, the append-to-existing path, id
 * dedupe, and the placement spacing math it shares with the canvas's own
 * "+ add" affordance (`site-client.tsx`).
 */
describe("appendInstanceToDocument", () => {
  const input = { opening_width_mm: 4000 };

  it("opens a fresh project (`site: null`) with one instance at the origin", () => {
    const { document, instanceId } = appendInstanceToDocument(
      { site: null, instances: [] },
      "project-1",
      "sliding-gate@1",
      input,
    );
    expect(instanceId).toBe("sliding-gate-1");
    expect(document.site.terrain).toEqual(emptySite("project-1").terrain);
    expect(document.site.connections).toEqual(emptySite("project-1").connections);
    expect(document.instances).toEqual([
      { instanceId: "sliding-gate-1", releaseId: "sliding-gate@1", input },
    ]);
    expect(document.site.placements).toEqual([
      { instanceId: "sliding-gate-1", pose: { origin_mm: { x: 0, y: 0 } } },
    ]);
  });

  it("appends to an already-designed site, past the rightmost placement", () => {
    const existingSite = {
      ...emptySite("project-1"),
      placements: [
        { instanceId: "fence-run-1", pose: { origin_mm: { x: 0, y: 0 } } },
        { instanceId: "fence-run-2", pose: { origin_mm: { x: 6000, y: 0 } } },
      ],
    };
    const existingInstances: ProjectInstanceInput[] = [
      { instanceId: "fence-run-1", releaseId: "fence-run@1", input: {} },
      { instanceId: "fence-run-2", releaseId: "fence-run@1", input: {} },
    ];

    const { document, instanceId } = appendInstanceToDocument(
      { site: existingSite, instances: existingInstances },
      "project-1",
      "sliding-gate@2",
      input,
    );

    expect(instanceId).toBe("sliding-gate-1");
    expect(document.instances).toHaveLength(3);
    expect(document.instances.at(-1)).toEqual({
      instanceId: "sliding-gate-1",
      releaseId: "sliding-gate@2",
      input,
    });
    const placed = document.site.placements.at(-1)!;
    expect(placed.instanceId).toBe("sliding-gate-1");
    expect(placed.pose.origin_mm).toEqual({ x: 6000 + PLACE_SPACING_MM, y: 0 });
    // Existing placements/instances are untouched.
    expect(document.site.placements.slice(0, 2)).toEqual(existingSite.placements);
  });

  it("dedupes the instance id against BOTH the roster and the placements", () => {
    // A roster entry `sliding-gate-1` from a DIFFERENT release (or a placement
    // whose roster entry was pruned) must not collide with the new one.
    const existingSite = {
      ...emptySite("project-1"),
      placements: [{ instanceId: "sliding-gate-1", pose: { origin_mm: { x: 0, y: 0 } } }],
    };
    const existingInstances: ProjectInstanceInput[] = [
      { instanceId: "sliding-gate-2", releaseId: "sliding-gate@1", input: {} },
    ];

    const { instanceId } = appendInstanceToDocument(
      { site: existingSite, instances: existingInstances },
      "project-1",
      "sliding-gate@1",
      input,
    );

    // -1 and -2 are both taken (one by a placement, one by the roster) — the
    // first free slot is -3.
    expect(instanceId).toBe("sliding-gate-3");
  });

  it("derives the id's model prefix from the releaseId (drops the @version)", () => {
    const { instanceId } = appendInstanceToDocument(
      { site: null, instances: [] },
      "project-1",
      "fence-run@3",
      input,
    );
    expect(instanceId).toBe("fence-run-1");
  });

  it("spaces two hand-off appends in sequence exactly like the canvas would", () => {
    const first = appendInstanceToDocument(
      { site: null, instances: [] },
      "p",
      "sliding-gate@1",
      input,
    );
    const second = appendInstanceToDocument(
      { site: first.document.site, instances: first.document.instances },
      "p",
      "sliding-gate@1",
      input,
    );
    expect(second.instanceId).toBe("sliding-gate-2");
    expect(second.document.site.placements.map((p) => p.pose.origin_mm.x)).toEqual([
      0,
      PLACE_SPACING_MM,
    ]);
  });
});
