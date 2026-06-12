import { extendConfig } from "@repo/vitest-config/base";
import { reactConfig } from "@repo/vitest-config/react";

// jsdom + React, plus an inline of `@tanstack/react-query`: pnpm's isolated
// node_modules can hoist a second react under the query lib, breaking the
// single-instance hooks invariant under Vitest's resolver; dedupe alone wasn't
// enough, so Vite owns its resolution end-to-end.
export default extendConfig(reactConfig, {
  test: { server: { deps: { inline: ["@tanstack/react-query"] } } },
});
