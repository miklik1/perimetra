/**
 * The editor's compute worker (ADR 0068 Phase 4): runs the pure validation AND
 * live-preview derive off the main thread so the editor stays responsive while a
 * release grows. Thin by design — all logic lives in `release-engine.ts`
 * (testable without a Worker); this file is only the message pump. The catalog
 * and price table are cached here (sent on change) so they are not re-cloned per
 * keystroke.
 *
 * Referenced via `new Worker(new URL("./release-engine.worker.ts",
 * import.meta.url), { type: "module" })` in `use-engine-worker.ts`.
 */
import type { CostTable, PriceTable } from "@repo/engine";
import type { Catalog } from "@repo/model";

import {
  runReleasePreview,
  runReleaseValidation,
  type EngineRequest,
  type EngineResponse,
} from "./release-engine";

// The web tsconfig ships the DOM lib (not webworker), so `self` is typed as
// Window. Narrow to the worker surface we actually use rather than pull in a
// conflicting lib.
type WorkerScope = {
  onmessage: ((event: MessageEvent<EngineRequest>) => void) | null;
  postMessage: (message: EngineResponse) => void;
};
const ctx = self as unknown as WorkerScope;

let catalog: Catalog | null = null;
let prices: PriceTable | null = null;
let cost: CostTable | null = null;

ctx.onmessage = (event) => {
  const message = event.data;
  switch (message.kind) {
    case "catalog":
      catalog = message.catalog;
      return;
    case "prices":
      prices = message.prices;
      cost = message.cost;
      return;
    case "validate":
      ctx.postMessage({
        kind: "validate",
        id: message.id,
        result: runReleaseValidation(message.values, catalog),
      });
      return;
    case "preview":
      ctx.postMessage({
        kind: "preview",
        id: message.id,
        result: runReleasePreview(message.values, message.input, catalog, prices, cost),
      });
      return;
  }
};
