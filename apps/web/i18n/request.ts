import { getRequestConfig } from "next-intl/server";

import { buildRequestConfig } from "@repo/i18n/web/server";

// next-intl "without i18n routing" (ADR 0020): the per-request config that runs
// during the RSC render pass. The actual logic — read the locale cookie, narrow
// it, pick the catalog — lives in `@repo/i18n` (`buildRequestConfig`) so the app
// file is a one-liner and the contract stays in the package. Wired to next-intl
// via `createNextIntlPlugin('./i18n/request.ts')` in next.config.js.
export default getRequestConfig(async () => buildRequestConfig());
