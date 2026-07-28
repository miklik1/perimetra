import { designAdherenceConfig } from "@repo/eslint-config/design-adherence";
import { reactInternalConfig } from "@repo/eslint-config/react-internal";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...(Array.isArray(reactInternalConfig) ? reactInternalConfig : [reactInternalConfig]),
  // Design adherence (ADR 0137) — the export's own rules, read from
  // `_adherence.oxlintrc.json`. The kit is the surface the export is most directly
  // about, so it is gated on the same terms as the app.
  designAdherenceConfig({
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}"],
  }),
];
