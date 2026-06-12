/**
 * Client flags boot (ADR 0028) — the BROWSER half of the flags wiring, called
 * once per browser runtime from `instrumentation-client.ts` (the server half
 * is `bootServerFlags` in `server-flags.ts`).
 *
 * On web, flag reads do NOT go through the `@repo/flags` sync carrier
 * (`configureFlags`/`getFlags`): the client reads via `useFlag`/`useFlagValue`
 * over `FlagsContext` (state seeded by the per-request server bootstrap and
 * `posthog.getFeatureFlag`), and the server reads via the async
 * `getFlag`/`getAllFlags` surface. The carrier exists for the native
 * non-React read path; wiring it here would write a holder nothing reads, so
 * the browser boot intentionally does nothing today.
 */
export function bootFlags(): void {
  // Intentionally empty on web — see file header. PostHog client init and the
  // per-request server bootstrap are owned by `FlagsProvider`.
}
