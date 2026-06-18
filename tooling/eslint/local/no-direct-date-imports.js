/**
 * Custom ESLint rule: `no-direct-date-imports`.
 *
 * Bans direct imports of low-level date libraries (`date-fns`,
 * `temporal-polyfill`, `@js-temporal/polyfill`) outside designated
 * formatting/i18n packages.
 *
 * Why: date-fns format tokens are a footgun — latin letters that happen to be
 * tokens (`l`, `D`, `Y`, `t`, `v`, `c`) crash with:
 *   `RangeError: Format string contains an unescaped latin alphabet character`
 * when wrapped in literal text. Funnelling all date logic through a shared
 * formatting helper eliminates the problem at one boundary (the wrapper renders
 * via `Intl.DateTimeFormat`, which has no parser to confuse).
 *
 * Temporal is included for symmetry: callers that hold a `Temporal.PlainDate`
 * should still go through the formatting helpers so the rendering pipeline is
 * uniform; the polyfill itself stays an implementation detail of the
 * formatting package.
 *
 * Rule options (schema index 0):
 *   allowedPathFragments {string[]}
 *     Substrings of the normalized file path that are exempt from this rule.
 *     Default: [] — no formatting package exists in the skeleton yet. Add the
 *     path fragment of your shared date/formatting package here when it exists
 *     (e.g. "/packages/formatting/src/" or "/packages/i18n/src/").
 *
 *   bannedModules {string[]}
 *     Exact module names to ban (plus any that start with a banned-module name
 *     followed by "/", catching subpath imports like `date-fns/format`).
 *     Default: ["date-fns", "date-fns/locale", "temporal-polyfill",
 *               "@js-temporal/polyfill"].
 */

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Direct imports of `date-fns`, `temporal-polyfill`, or `@js-temporal/polyfill` are banned outside the shared formatting package. Import date helpers from that package instead.",
    },
    schema: [
      {
        type: "object",
        properties: {
          allowedPathFragments: {
            type: "array",
            items: { type: "string" },
            description:
              "Substrings of the normalized absolute file path that are exempt (e.g. the formatting package src dir).",
          },
          bannedModules: {
            type: "array",
            items: { type: "string" },
            description:
              "Exact module names to ban (subpath variants like `date-fns/format` are also banned via prefix matching).",
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      direct:
        "Import date helpers from the shared formatting package instead of '{{module}}' directly. " +
        "The wrapper renders via Intl.DateTimeFormat / Intl.RelativeTimeFormat to sidestep " +
        "date-fns format-token crashes (unescaped latin alphabet characters like `D`, `Y`, `t` " +
        "in format strings cause RangeError at runtime). " +
        "For third-party library locale props (react-day-picker, sonner, etc.) re-export the " +
        "locale objects from the formatting package.",
    },
  },
  create(context) {
    // Read options, applying defaults.
    const options = context.options[0] ?? {};

    const allowedPathFragments = options.allowedPathFragments ?? [];

    // Default banned modules: the known footgun libraries. date-fns/locale is
    // listed separately because it is an exact module (not just a prefix).
    const bannedModulesRaw = options.bannedModules ?? [
      "date-fns",
      "date-fns/locale",
      "temporal-polyfill",
      "@js-temporal/polyfill",
    ];
    const bannedModuleSet = new Set(bannedModulesRaw);
    // Prefix-based matching catches subpath imports (date-fns/format,
    // date-fns/parseISO, @js-temporal/polyfill/something, etc.).
    const bannedPrefixes = bannedModulesRaw.map((m) => m + "/");

    function isBannedModule(name) {
      if (bannedModuleSet.has(name)) return true;
      return bannedPrefixes.some((prefix) => name.startsWith(prefix));
    }

    const filename = context.filename ?? context.getFilename();
    const normalised = filename.replace(/\\/g, "/");

    // Allowed files: the shared formatting / i18n package source dirs.
    // When allowedPathFragments is empty (skeleton default — no formatting
    // package yet) every file is subject to the rule.
    if (
      allowedPathFragments.length > 0 &&
      allowedPathFragments.some((frag) => normalised.includes(frag))
    ) {
      return {};
    }

    return {
      ImportDeclaration(node) {
        const name = node.source.value;
        if (typeof name !== "string") return;
        if (!isBannedModule(name)) return;
        context.report({
          node: node.source,
          messageId: "direct",
          data: { module: name },
        });
      },
    };
  },
};

export default rule;
