/**
 * The editor's compute worker (ADR 0068 Phase 4): runs the pure validation
 * pipeline off the main thread so the editor stays responsive while a release
 * grows (and so the heavier live-preview derive can join it next). Thin by
 * design — all logic lives in `release-engine.ts` (testable without a Worker);
 * this file is only the message pump.
 *
 * Referenced via `new Worker(new URL("./release-engine.worker.ts",
 * import.meta.url), { type: "module" })` in `use-release-validation.ts`.
 */
import type { Catalog } from "@repo/model";

import { runReleaseValidation, type EngineRequest, type EngineResponse } from "./release-engine";

// The web tsconfig ships the DOM lib (not webworker), so `self` is typed as
// Window. Narrow to the worker surface we actually use rather than pull in a
// conflicting lib.
type WorkerScope = {
  onmessage: ((event: MessageEvent<EngineRequest>) => void) | null;
  postMessage: (message: EngineResponse) => void;
};
const ctx = self as unknown as WorkerScope;

let catalog: Catalog | null = null;

ctx.onmessage = (event) => {
  const message = event.data;
  if (message.kind === "catalog") {
    catalog = message.catalog;
    return;
  }
  // kind === "validate"
  const result = runReleaseValidation(message.values, catalog);
  ctx.postMessage({ kind: "validate", id: message.id, result });
};
