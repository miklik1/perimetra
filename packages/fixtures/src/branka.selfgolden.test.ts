/**
 * Structural self-golden for the `branka@1` technical drawing (spike, 2026-07-08
 * — ADR 0102). The spot-check tests in `branka.drawing.test.ts` prove the
 * emitter prints the ENGINE's numbers; this test locks the WHOLE emitted
 * `TechnicalDrawing` byte-for-byte — every projected edge, every placed
 * annotation, every section cut, the bbox — so a silent geometry/layout drift in
 * ANY pipeline stage fails HERE, in CI, the same guard the ADR-0095 position
 * golden gives the 3D scene.
 *
 * The lock is legitimate ONLY because the emitter is deterministic: integer-mm
 * projection (`snap`), id-keyed edge/annotation ordering (I9), integer arc-minute
 * trig. That determinism is the property the golden defends.
 *
 * Regenerate after an INTENTIONAL emitter change (review the JSON diff — it is
 * the change, made visible):
 *
 *   UPDATE_DRAWING_GOLDEN=1 pnpm --filter @repo/fixtures test branka.selfgolden
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { deriveInstance } from "@repo/engine";
import { buildTechnicalDrawing } from "@repo/renderers";

import { catalogV1 } from "./catalog/catalog-v1.js";
import { brankaPrices, planka_100_2d_1xsp } from "./golden/branka.js";
import { brankaV1 } from "./releases/branka.js";

const GOLDEN_PATH = fileURLToPath(new URL("./golden/branka-drawing.golden.json", import.meta.url));

describe("branka@1 — technical-drawing self-golden (structural regression lock)", () => {
  const result = deriveInstance(brankaV1, planka_100_2d_1xsp.config, brankaPrices, catalogV1);
  const drawing = buildTechnicalDrawing(result, brankaV1.drawing);

  it("emits byte-identical geometry to the committed golden", () => {
    const actual = `${JSON.stringify(drawing, null, 2)}\n`;
    if (process.env.UPDATE_DRAWING_GOLDEN) writeFileSync(GOLDEN_PATH, actual);
    const expected = readFileSync(GOLDEN_PATH, "utf8");
    expect(actual).toBe(expected);
  });

  it("is stable across a re-derivation (the property the lock defends)", () => {
    const again = buildTechnicalDrawing(
      deriveInstance(brankaV1, planka_100_2d_1xsp.config, brankaPrices, catalogV1),
      brankaV1.drawing,
    );
    expect(JSON.stringify(again)).toBe(JSON.stringify(drawing));
  });
});
