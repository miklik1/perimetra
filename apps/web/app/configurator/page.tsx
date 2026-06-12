import { ConfiguratorClient } from "./configurator-client";

/**
 * Protected configurator page (step 6 slice 1). No server prefetch: releases
 * come from the interim fixtures source (./products.ts) and the engine runs
 * client-side, so the RSC shell stays static. Access is owned by the proxy
 * gate (`/configurator` in PROTECTED_PREFIXES) + <AuthGuard> in the client
 * subtree, exactly like /projects.
 */
export default function ConfiguratorPage() {
  return <ConfiguratorClient />;
}
