// Self-reference via the package `exports` map (NOT a relative `./web`): this
// module is pulled into next.config.js's Node ESM graph, which resolves package
// specifiers but NOT relative extensionless `.ts` paths (vault finding
// "Multi-tier Vercel (Next) deploy …" lesson 2). Its own import MUST therefore
// also be a package specifier.
import { env, TIER } from "@repo/config/env/web";

/**
 * Build-time tier-invariant guard — the build-time half of "gate at build AND
 * runtime". Called at `apps/web/next.config.js` load time so a tier/env
 * contradiction FAILS `next build` BEFORE any chunk is emitted: a copy-pasted
 * preview env scope on the Production environment hard-fails instead of silently
 * shipping mocks, and a prod deploy silently missing its real backend origin is
 * caught at build, not by the first user.
 *
 * Lives with the web env schema (`./web`) because it is that schema's own
 * cross-field validity policy. Imported by next.config.js via the package
 * `exports` map — relative `.ts` paths don't resolve under next.config's Node
 * ESM loader; package specifiers do (finding lesson 2).
 *
 * This is the MINIMAL generalized subset: the skeleton ships no slice /
 * stage-mix / password-login machinery, so those Primat-only checks (Primat
 * Plus ADR 0047 — a different project's numbering, not perimetra's error
 * taxonomy) are intentionally absent. Skipped under SKIP_ENV_VALIDATION (matching
 * @t3-oss/env's escape hatch for Docker builds / standalone CI type-checks),
 * EXCEPT it REFUSES that flag outright on a real Production target.
 */
export function assertTierInvariants(): void {
  // A canonical Vercel Production target, normalised the SAME way resolveTier
  // normalises it (trim + lower-case) so a mis-cased override can't slip past.
  const onVercelProduction = process.env.VERCEL_TARGET_ENV?.trim().toLowerCase() === "production";

  // SKIP_ENV_VALIDATION must NEVER be set on a prod-TIER build — it would no-op
  // BOTH @t3-oss validation and this guard at once, so a prod deploy could ship
  // mocks / miss its backend origin entirely unchecked. Covers BOTH a Vercel
  // Production target AND the non-Vercel APP_TIER=prod container/standalone
  // build (which never sets VERCEL_TARGET_ENV) — keying only on the Vercel var
  // would leave the container prod path able to skip the whole guard. Checked on
  // RAW process.env / the resolved TIER so it holds even when validation is
  // skipped; a local/CI/preview build (tier=preview) may still skip freely.
  if ((onVercelProduction || TIER === "prod") && process.env.SKIP_ENV_VALIDATION) {
    throw new Error(
      "SKIP_ENV_VALIDATION must not be set on a prod-tier build (VERCEL_TARGET_ENV=production or APP_TIER=prod) — it disables env validation and the tier-invariant guard.",
    );
  }
  if (process.env.SKIP_ENV_VALIDATION) return;

  const violations: string[] = [];

  if (TIER === "prod") {
    if (env.NEXT_PUBLIC_ENABLE_MSW === "true") {
      violations.push(
        'NEXT_PUBLIC_ENABLE_MSW must not be "true" on prod — mocks are forbidden on the live tier.',
      );
    }
    if (env.API_URL === undefined) {
      violations.push("API_URL must be set on prod (the real backend origin behind the BFF).");
    }
  }

  // PERIMETRA DEVIATION from the skeleton's preview rules (ADR 0104). Upstream
  // forbids `API_URL` on preview outright, because the skeleton is a mock-first
  // demo whose preview deploys ARE the fixtures. Perimetra is a real-backend
  // product: local dev, preview and prod all point at a real api, so that rule
  // would fail `next build` in every environment we actually have. What survives
  // is the hazard the rule was protecting against — an AMBIGUOUS data source on
  // a non-live tier — expressed directly:
  //
  //  - mocks explicitly on WITH a backend origin: `mocksEnabled` makes the mock
  //    win at the BFF, so the configured API_URL is silently ignored. A reviewer
  //    reads fixtures believing they are reading staging. Forbid the pair.
  //  - mocks explicitly off WITHOUT a backend origin: the BFF proxies its
  //    `http://localhost:4000` default (the jsonplaceholder demo host upstream).
  //    Forbid that too — this is the upstream rule, kept verbatim.
  //
  // Both unset stays legal: that is the documented fresh-clone full-mock
  // fallback (`pnpm dev` with no backend), and `next dev` loads this guard too.
  if (TIER === "preview") {
    if (env.NEXT_PUBLIC_ENABLE_MSW === "false" && env.API_URL === undefined) {
      violations.push(
        'NEXT_PUBLIC_ENABLE_MSW is "false" but API_URL is unset on preview — the BFF would proxy its localhost/demo default instead of a real backend. Set API_URL, or leave ENABLE_MSW unset/"true" for the full-mock fallback.',
      );
    }
    if (env.NEXT_PUBLIC_ENABLE_MSW === "true" && env.API_URL !== undefined) {
      violations.push(
        'NEXT_PUBLIC_ENABLE_MSW is "true" AND API_URL is set on preview — an ambiguous data source: the mock wins at the BFF and the configured backend origin is silently ignored. Choose one.',
      );
    }
  }

  // stage has no hard constraints: a slice-granular mock+real mix is the point.
  // The skeleton ships no slice flags yet; the tier still exists for derived
  // projects that add them (Primat ADR 0047 is the richer reference).

  // Defense-in-depth: the Production Vercel environment MUST resolve to prod.
  // resolveTier guarantees this; a broken/edited resolver or a spoofed var is
  // caught here rather than silently downgrading prod to a mock tier. Uses the
  // SAME normalised check as resolveTier so it stays meaningful for a
  // non-canonical value.
  if (onVercelProduction && TIER !== "prod") {
    violations.push(
      `VERCEL_TARGET_ENV is "${process.env.VERCEL_TARGET_ENV}" (a Production target) but TIER resolved to "${TIER}" — the tier resolver is broken.`,
    );
  }

  if (violations.length > 0) {
    throw new Error(
      `assertTierInvariants: illegal environment for TIER="${TIER}":\n` +
        violations.map((v) => `  - ${v}`).join("\n"),
    );
  }
}
