/**
 * slotScopes over the real authored corpus — the model unit test locks the
 * scope rules on a synthetic release; this proves slotScopes covers every
 * expression slot of the actual shipped releases (so the editor's autocomplete
 * lights up on real models), and that the corpus still validates clean.
 */
import { describe, expect, it } from "vitest";

import { slotScopes, validateRelease } from "@repo/model";

import { fenceRunV1 } from "./releases/fence-run.js";
import { slidingGateV1 } from "./releases/sliding-gate.js";

describe("slotScopes — authored corpus coverage", () => {
  for (const release of [slidingGateV1, fenceRunV1]) {
    describe(release.id, () => {
      const scopes = slotScopes(release);

      it("has a scope for every derived dimension", () => {
        for (const d of release.derivation.derived) {
          expect(scopes.has(`derived[${d.key}]`)).toBe(true);
        }
      });

      it("has a scope for every part's bom.quantity", () => {
        for (const part of release.derivation.parts) {
          expect(scopes.has(`parts[${part.path}].bom.quantity`)).toBe(true);
        }
      });

      it("validates clean (the publish gate consumes the same scopes)", () => {
        expect(validateRelease(release)).toEqual([]);
      });
    });
  }
});
