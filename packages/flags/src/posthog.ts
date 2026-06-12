/**
 * Vendor constants shared by every PostHog binding and the app boot files.
 * SDK-free (a string, not an import), so it may ride the neutral barrel.
 * EU cloud per ADR 0028 (CZ data-residency context).
 */
export const POSTHOG_EU_HOST = "https://eu.i.posthog.com";
