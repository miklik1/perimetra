/**
 * The configurator's compute worker (ADR 0116) — runs the pure `deriveForUi` off
 * the main thread so the form stays responsive per keystroke and the drag loop
 * (§7.6) keeps its frames. Thin by design: all logic lives in
 * `configurator-engine.ts` (testable without a Worker); this file is only the
 * message pump. Product/catalogs/pricing are cached here, sent on change, so
 * they are not re-cloned per derive.
 *
 * Referenced via `new Worker(new URL("./configurator-engine.worker.ts",
 * import.meta.url), { type: "module" })` at the hook's own call site — bundlers
 * statically analyse that exact expression.
 */
import {
  runConfiguratorDerive,
  type EngineContext,
  type EngineRequest,
  type EngineResponse,
} from "./configurator-engine";

// The web tsconfig ships the DOM lib (not webworker), so `self` is typed as
// Window. Narrow to the worker surface we actually use rather than pull in a
// conflicting lib. (Same narrowing as `release-engine.worker.ts`.)
type WorkerScope = {
  onmessage: ((event: MessageEvent<EngineRequest>) => void) | null;
  postMessage: (message: EngineResponse) => void;
};
const ctx = self as unknown as WorkerScope;

const cache: EngineContext = { product: null, catalogs: null, pricing: null };

ctx.onmessage = (event) => {
  const message = event.data;
  switch (message.kind) {
    case "context":
      cache.product = message.product;
      cache.catalogs = new Map(message.catalogs);
      return;
    case "pricing":
      cache.pricing = message.pricing;
      return;
    case "derive":
      ctx.postMessage({
        kind: "derive",
        id: message.id,
        result: runConfiguratorDerive(message.input, cache),
      });
      return;
  }
};
