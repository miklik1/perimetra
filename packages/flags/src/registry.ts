/**
 * The typed flag registry (ADR 0028): every flag the codebase reads is declared
 * here with its default — no stringly-typed keys anywhere else. The default is
 * what `createStaticFlags` serves (SSR before boot, tests, no PostHog key) and
 * what every adapter falls back to for an unknown/unloaded flag, so a flag's
 * "off" state is defined exactly once.
 *
 * Boolean flags: `{ default: false }`. Multivariate flags carry their variant
 * union on the default's annotation, which `FlagValue` picks up:
 *
 *   "ranking-algo": { default: "control" as "control" | "v2" },
 */
export const FLAGS = {
  // Demo flag: gates the home page's infinite users list (apps/web). Default
  // `true` so a key-less run renders the page exactly as before flags existed;
  // toggling it OFF in PostHog hides the section — the end-to-end proof.
  "example-flag": { default: true },
} as const;

export type FlagKey = keyof typeof FLAGS;

/**
 * Consent annotation (ADR 0036, GDPR): a flag declared with
 * `requiresConsent: true` must not be evaluated CLIENT-side before analytics
 * consent (the provider gates PostHog boot on it); anonymous server-side
 * evaluation and registry defaults stay allowed. Most flags don't need it —
 * only ones whose evaluation reveals behavioral targeting.
 *
 * @public the seam for a project's consent gate (web or native) — kept
 * exported even while no in-repo consumer is wired, by design.
 */
export function flagsRequiringConsent(): FlagKey[] {
  return (Object.entries(FLAGS) as [FlagKey, { default: unknown; requiresConsent?: boolean }][])
    .filter(([, definition]) => definition.requiresConsent === true)
    .map(([key]) => key);
}

/**
 * Widen literal boolean defaults (`as const` freezes `true` to the literal) so
 * a boolean flag's value type is `boolean`, not its default. Distributes over
 * unions, so multivariate `as "control" | "v2"` annotations pass through.
 */
type Widen<T> = T extends boolean ? boolean : T;

/** The value type of one flag, derived from its registry default. */
export type FlagValue<K extends FlagKey> = Widen<(typeof FLAGS)[K]["default"]>;
