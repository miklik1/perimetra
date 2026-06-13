import { SiteClient } from "./site-client";

/**
 * Protected site canvas page (step 6 slice 2). No server prefetch: the seed
 * project comes from the interim fixtures source (./initial.ts) and the engine
 * runs client-side, so the RSC shell stays static. Access is owned by the proxy
 * gate (`/site` in PROTECTED_PREFIXES) + <AuthGuard> in the client subtree,
 * exactly like /configurator.
 */
export default function SitePage() {
  return <SiteClient />;
}
