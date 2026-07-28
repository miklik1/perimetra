/**
 * ADR 0136's load-bearing claim, proven rather than asserted: `dimensionRole` is
 * DESCRIPTIVE — it enters no expression scope, no derivation and no price path,
 * so it cannot move a golden.
 *
 * The proof is a differential one, and it doubles as the I3 story at the model
 * layer. Stripping the field off an authored release reconstructs EXACTLY the
 * body that release had before ADR 0136 — which is the body every quote issued
 * before this change has frozen in its snapshot. Deriving both bodies and
 * comparing the serialized results byte-for-byte shows that a pre-change frozen
 * body and a re-authored one produce the same artifacts, which is what
 * `verifyReproducibility` compares.
 *
 * If someone ever makes the role referenceable from an Expr (a `slotScopes`
 * entry, a derived key that reads it), this file goes red — which is the point.
 */
import { describe, expect, it } from "vitest";

import { deriveInstance } from "@repo/engine";
import type { ProductModelRelease } from "@repo/model";

import { catalogV1 } from "./catalog/catalog-v1.js";
import { catalogV2 } from "./catalog/catalog-v2.js";
import { brankaGoldens } from "./golden/branka.js";
import { fenceGoldens } from "./golden/fence-run.js";
import { slidingGateGoldens } from "./golden/sliding-gate.js";
import { swingGateGoldens } from "./golden/swing-gate.js";
import { brankaV1 } from "./releases/branka.js";
import { fenceRunV1 } from "./releases/fence-run.js";
import { slidingGateV1 } from "./releases/sliding-gate.js";
import { swingGateV1 } from "./releases/swing-gate.js";

/** The same release as it was authored BEFORE ADR 0136 — i.e. the body shape a
 *  pre-change quote froze. Only the optional role is removed; nothing else. */
function withoutDimensionRoles(release: ProductModelRelease): ProductModelRelease {
  return {
    ...release,
    parameters: release.parameters.map((p) => {
      const stripped = { ...p };
      delete stripped.dimensionRole;
      return stripped;
    }),
  };
}

const cases = [
  { release: slidingGateV1, catalog: catalogV1, golden: slidingGateGoldens[0]! },
  { release: swingGateV1, catalog: catalogV2, golden: swingGateGoldens[0]! },
  { release: brankaV1, catalog: catalogV2, golden: brankaGoldens[0]! },
  { release: fenceRunV1, catalog: catalogV2, golden: fenceGoldens[0]! },
];

describe("dimensionRole is descriptive — it cannot move a derivation (ADR 0136)", () => {
  for (const { release, catalog, golden } of cases) {
    it(`${release.id} derives byte-identically with and without the roles`, () => {
      const authored = deriveInstance(release, golden.config, golden.prices, catalog);
      const preChange = deriveInstance(
        withoutDimensionRoles(release),
        golden.config,
        golden.prices,
        catalog,
      );
      expect(JSON.stringify(preChange)).toBe(JSON.stringify(authored));
    });

    it(`${release.id} still authors the roles the configurator binds by`, () => {
      // The differential above is vacuous if nothing carries a role — pin that
      // the corpus actually exercises the field.
      const roles = release.parameters.map((p) => p.dimensionRole).filter(Boolean);
      expect(roles.sort()).toEqual(["height", "width"]);
    });
  }
});
