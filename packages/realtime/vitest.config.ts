import { reactConfig } from "@repo/vitest-config/react";

// jsdom + React hook suite (`useChannel` / `useConnectionState`) — the shared
// react base (plugin-react, dedupe, jest-dom/cleanup setup) is the whole config.
export default reactConfig;
