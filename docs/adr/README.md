# Architecture Decision Records

Each ADR captures one decision: the context, the decision, why, and the
consequences. To change a decision, supersede it with a revised ADR.

Format: Status / Context / Decision / Consequences / Sources.

"Status" is the ADR's decision status (all Accepted). "Implementation" tracks
the as-built reality: **Implemented** (shipped), **Partial** (core shipped, a
device/external-account-gated step remains), or **Seam** (decided and the seam
exists, deliberately not wired — by design).

| ADR                                                        | Title                                                                                               | Status   | Implementation                                  |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------- |
| [0001](0001-styling-split-ui-tailwind-v4.md)               | Split UI: web Tailwind v4 + shadcn, mobile NativeWind v5; shared token theme                        | Accepted | Partial — device smoke-test pending             |
| [0002](0002-reanimated-4-retained.md)                      | Retain Reanimated 4 (no NativeWind conflict)                                                        | Accepted | Partial — installed; device run pending         |
| [0003](0003-cross-platform-navigation.md)                  | Per-platform routing + in-repo route contract (no Solito)                                           | Accepted | Implemented                                     |
| [0004](0004-theming-token-system.md)                       | Shared Tailwind v4 `@theme` token system                                                            | Accepted | Implemented                                     |
| [0005](0005-testing-two-runner-split.md)                   | Vitest (web + shared) / Jest (mobile); Maestro E2E                                                  | Accepted | Partial — Maestro/EAS activation pending        |
| [0006](0006-split-ui-web-dom-mobile-rn.md)                 | Split UI: web DOM/RSC, mobile RN; share logic not pixels                                            | Accepted | Implemented                                     |
| [0007](0007-rest-data-layer.md)                            | REST data layer: stable `@repo/api` barrel, OpenAPI-or-hand-written behind it                       | Accepted | Implemented                                     |
| [0008](0008-shared-package-boundaries.md)                  | Shared package boundaries: separate api / validators / utils / config; retire `@repo/shared`        | Accepted | Implemented                                     |
| [0009](0009-forms-rhf-zod-no-package.md)                   | Forms: React Hook Form + zod, schemas in `@repo/validators`, no `@repo/forms` package               | Accepted | Implemented                                     |
| [0010](0010-ui-state-zustand-store-package.md)             | UI state: Zustand in a `@repo/store` package; theme as the first store                              | Accepted | Implemented                                     |
| [0011](0011-enforce-package-boundaries-with-eslint.md)     | Enforce the ADR 0008 dependency DAG with `eslint-plugin-boundaries`                                 | Accepted | Implemented                                     |
| [0012](0012-api-client-factory.md)                         | API client as an explicit factory (no module-global transport); middleware + AbortSignal            | Accepted | Implemented                                     |
| [0013](0013-expo-sdk-56-upgrade.md)                        | Upgrade to Expo SDK 56 (RN 0.85 + React 19.2 + TypeScript 6.0); supersedes ADR 0002 pins            | Accepted | Implemented                                     |
| [0014](0014-error-handling-exceptions-at-the-data-seam.md) | Error handling: exceptions at the data-layer seam; no `Result` idiom                                | Accepted | Implemented                                     |
| [0015](0015-mobile-storage-asyncstorage-over-mmkv.md)      | Mobile key-value storage: AsyncStorage over MMKV — keep the app Expo Go-compatible                  | Accepted | Implemented                                     |
| [0016](0016-auth-jwt-refresh-package.md)                   | Auth: JWT + refresh-token rotation in a `@repo/auth` package; refresh as injected middleware        | Accepted | Partial — web wired; mobile adapter deferred    |
| [0017](0017-auth-client-hardening.md)                      | Auth client hardening: cookie access token, cross-tab refresh lock, server-side gating              | Accepted | Implemented (web)                               |
| [0018](0018-bff-route-handler-and-shared-mocks.md)         | Same-origin BFF route handler + shared framework-agnostic mocks (`@repo/api-mocks`)                 | Accepted | Implemented                                     |
| [0019](0019-openapi-codegen-seam.md)                       | OpenAPI codegen seam: hand-written zod kept swap-ready for `@hey-api/openapi-ts` (documented)       | Accepted | Seam — documented, not wired (by design)        |
| [0020](0020-i18n-next-intl-use-intl.md)                    | i18n: `@repo/i18n` with next-intl (web) + use-intl (mobile), shared ICU catalogs                    | Accepted | Implemented                                     |
| [0021](0021-telemetry-observability-package.md)            | Telemetry: `@repo/telemetry` — Sentry errors/perf + logging sink + agnostic analytics seam          | Accepted | Partial — native Sentry capture deferred        |
| [0022](0022-typed-search-params-route-dx.md)               | Route DX: zod-typed search params + active-route helpers in `@repo/navigation` (`navigation → zod`) | Accepted | Implemented                                     |
| [0023](0023-datetime-intl-temporal-deferred.md)            | Date/time: Intl-based formatting; no date-math lib; Temporal deferred behind a lib-agnostic seam    | Accepted | Seam — Temporal deferred (by design)            |
| [0024](0024-scaffolding-generators-turbo-gen.md)           | Scaffolding generators (`@turbo/gen`): auto-wired `package` / `api-resource` / `route` generators   | Accepted | Implemented                                     |
| [0025](0025-web-e2e-playwright-shared-vitest-config.md)    | Web E2E (Playwright, mock-mode) + shared `tooling/vitest-config`; no `@repo/testing` grab-bag       | Accepted | Implemented                                     |
| [0026](0026-web-security-headers-csp.md)                   | Web security headers + nonce-based CSP (standalone deploy)                                          | Accepted | Implemented                                     |
| [0027](0027-toast-notification-store.md)                   | Toast/notification queue as the second `@repo/store` store (custom Toaster, pure queue)             | Accepted | Implemented                                     |
| [0028](0028-feature-flags-posthog.md)                      | Feature flags: `@repo/flags` seam + PostHog adapter (RSC bootstrap); shared client with telemetry   | Accepted | Implemented (web + mobile)                      |
| [0029](0029-realtime-package-centrifugo.md)                | Realtime: `@repo/realtime` seam + Centrifugo adapter (recovery-aware, mock + no-op defaults)        | Accepted | Seam — consumer-ready, no app wired (by design) |
| [0030](0030-api-response-envelope-seam.md)                 | API response-envelope seam in `createApiClient` (`unwrap` + `mapError`; amends 0007/0012)           | Accepted | Implemented                                     |
| [0031](0031-nestjs-modular-monolith-worker-split.md)       | Backend: NestJS 11 on Fastify — modular monolith, api/worker/migrate deployables from one image     | Accepted | Implemented (shell)                             |
| [0032](0032-postgres-drizzle-db-package.md)                | PostgreSQL + Drizzle 1.0-rc in `@repo/db` (built pkg, per-module schema, pii() registry, factories) | Accepted | Implemented (foundation)                        |
| [0033](0033-better-auth.md)                                | Auth: Better Auth cookie sessions (manual Fastify mount, Drizzle+Redis, admin on, org dormant)      | Accepted | Implemented (supersedes 0016/0017 client)       |
| [0034](0034-api-contract-and-seams.md)                     | API contract: shared zod = wire contract (records 0039); thin seams — webhooks, billing, AI, keys   | Accepted | Implemented (contract record); seams by design  |
| [0035](0035-infra-modules.md)                              | Infra modules: locale-aware email seam, S3 presign, Centrifugo v6 (closes 0029), 2-layer throttling | Accepted | Implemented (live-probed)                       |
| [0036](0036-backend-observability.md)                      | Backend observability: OTel (outbox trace continuity, gauges) + Sentry (PII-scrubbed) + PostHog BE  | Accepted | Implemented (live-probed)                       |
| [0037](0037-transactions-outbox.md)                        | Ambient @Transactional() (CLS) + transactional outbox (SKIP LOCKED relay, jobId dedup, IDs-only)    | Accepted | Implemented (concurrency-proven)                |
| [0043](0043-jobs-scheduling.md)                            | Jobs: BullMQ conventions, repeatables-only cron (@nestjs/schedule banned), DLQ + bull-board         | Accepted | Implemented                                     |
| [0038](0038-zero-downtime-migrations-pooling.md)           | Zero-downtime migrations (release-phase one-shot, expand/contract) + pooling doctrine               | Accepted | Doctrine (gates live with first migration)      |
| [0039](0039-api-semantics.md)                              | API semantics: keyset pagination, opt-in idempotency replay, mandatory zod response serialization   | Accepted | Implemented (live-probed)                       |
| [0040](0040-gdpr-privacy-audit.md)                         | GDPR plumbing: privacy export/erase fan-out, append-only audit, pii() registry, retention jobs      | Accepted | Implemented (live-probed)                       |
| [0041](0041-tenancy-seam.md)                               | Tenancy seam: scoped repositories + dormant org data model; 5-step retrofit playbook                | Accepted | Seam implemented (feature dormant by design)    |
| [0042](0042-template-lifecycle.md)                         | Template lifecycle: stamp-out script, two-channel updates, @repo scope stays                        | Accepted | Implemented                                     |
| [0044](0044-security-baseline-supply-chain.md)             | Security baseline + supply chain: hardening defaults, gitleaks/audit/Trivy CI gates, ASVS L2 map    | Accepted | Implemented (gates live in CI)                  |

## Project-owned ADRs (Perimetra rebuild, ≥0045 — never touched by skeleton merges)

| ADR                                         | Decision                                                                                             | Status   | Reality     |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------- | ----------- |
| [0045](0045-expr-numeric-domain-ieee754.md) | Expr DSL evaluates in IEEE-754 (delta-0 requires the MVP's arithmetic); I10 money hardens in step 3  | Accepted | Implemented |
| [0046](0046-catalog-role-resolution.md)     | Catalog = versioned engine argument; {role, section, material} resolution is the ONE component mech  | Accepted | Implemented |
| [0047](0047-error-taxonomy.md)              | Error taxonomy: author-time throws (validateRelease publish gate), config-time typed Issues + params | Accepted | Implemented |
| [0048](0048-cascade-overrides-ledger.md)    | Cascade/override semantics: one write path, quote-only deviations, ledger as query, 15-sig money     | Accepted | Implemented |
| [0049](0049-site-graph-composition.md)      | Site graph: port sharing (owner/consumer), terrain via input gate, paired connection scopes          | Accepted | Implemented |
| [0050](0050-renderer-layer.md)              | Renderer layer: keyed piece geometry on PartRule, baked catalog facts, pure data renderers (I4)      | Accepted | Implemented |
| [0051](0051-generated-configurator.md)      | Generated configurator: UiSpec on the release, browser-hosted engine, app-land R3F scene adapter     | Accepted | Implemented |
| [0052](0052-site-canvas.md)                 | Site canvas: generated surface at site scope, two-truths derive (footprints survive an invalid site) | Accepted | Implemented |

See [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) for the stack overview and
the consolidated constraints cheat-sheet.

ADRs 0001–0012 dated 2026-05-26; ADRs 0013–0014 (and the now-written 0009 / 0010)
dated 2026-06-01; ADR 0015 dated 2026-06-02; ADR 0016 dated 2026-06-03; ADRs
0017–0019 dated 2026-06-03; ADRs 0020–0028 dated 2026-06-04; ADRs 0029–0033, 0035,
0037–0038 and 0043 dated 2026-06-10; ADRs 0034, 0036, 0039–0042 and 0044 dated
2026-06-11. The numbering is complete — derived projects start at 0045 (see
[ADR 0042](0042-template-lifecycle.md)). Research against primary sources (npm,
GitHub, official docs, create-t3-turbo `main`) as of those dates.
