/**
 * Custom ESLint rule: `no-zod-resolver-without-use-zod-form`.
 *
 * Bans direct imports of `zodResolver` from `@hookform/resolvers/zod` outside
 * the shared `useZodForm` wrapper.
 *
 * Why: `useForm<TFormValues>({ resolver: zodResolver(schema) })` is a trap
 * for any schema with `z.preprocess` / `z.coerce` / `z.transform` — the
 * resolver returns `Resolver<z.input<S>, ..., z.output<S>>`, but the
 * `useForm<TFormValues>` generic forces both into the same slot. Under
 * `@hookform/resolvers` v3 + Zod v4 this miscompiles silently and produces a
 * bug where a modal swallows Save with no inline errors — `formState.errors`
 * stays empty. The shared `useZodForm(schema, options)` keeps the input/output
 * types separate (`z.input<S>` for register / defaultValues, `z.output<S>` for
 * `handleSubmit` callbacks) and locks in the v5 resolver behaviour.
 *
 * Fix: import `useZodForm` from the wrapper path instead of threading
 * `zodResolver` through `useForm` directly.
 *
 * The wrapper file is the only legitimate `zodResolver` consumer; the rule
 * exempts it by filename via the `allowedFileSuffixes` option.
 *
 * Rule options (schema index 0):
 *   allowedFileSuffixes {string[]}
 *     Path suffixes (tested with String#endsWith) whose files are exempt.
 *     Default: ["packages/ui/src/forms/use-zod-form.ts"] — the placement
 *     created alongside this rule in the skeleton.
 */

const RESOLVER_MODULE = "@hookform/resolvers/zod";

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Direct imports of `zodResolver` from `@hookform/resolvers/zod` are banned outside the shared `useZodForm` wrapper. Import `useZodForm` from the wrapper instead.",
    },
    schema: [
      {
        type: "object",
        properties: {
          allowedFileSuffixes: {
            type: "array",
            items: { type: "string" },
            description:
              "File path suffixes that are exempt from this rule (the wrapper file(s) that legitimately consume zodResolver).",
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      direct:
        "Import `useZodForm` from the shared wrapper instead of `zodResolver` directly. " +
        "Threading `zodResolver` through `useForm<TFormValues>` collapses Zod's input/output " +
        "types and miscompiles schemas with `coerce`/`preprocess`/`transform` — the symptom " +
        "is a silent-submit bug where `formState.errors` stays empty and the form swallows " +
        "Save with no user-visible feedback. " +
        "(@hookform/resolvers v3 + Zod v4 confirmed production regression.)",
    },
  },
  create(context) {
    // Read option, defaulting to the skeleton wrapper path.
    const options = context.options[0] ?? {};
    const allowedSuffixes = options.allowedFileSuffixes ?? [
      "packages/ui/src/forms/use-zod-form.ts",
    ];

    const filename = context.filename ?? context.getFilename();
    if (allowedSuffixes.some((suffix) => filename.endsWith(suffix))) {
      // This file is the wrapper itself — the single legitimate consumer.
      return {};
    }

    return {
      ImportDeclaration(node) {
        if (node.source.value !== RESOLVER_MODULE) return;
        // Any import of `@hookform/resolvers/zod` outside the wrapper is
        // the trap. Catches named, default, namespace, and side-effect forms:
        //   import { zodResolver } from "@hookform/resolvers/zod";
        //   import zodResolver from "@hookform/resolvers/zod";
        //   import * as resolvers from "@hookform/resolvers/zod";
        //   import "@hookform/resolvers/zod";
        // Reporting on the source string anchors the squiggle on the import path.
        context.report({
          node: node.source,
          messageId: "direct",
        });
      },
    };
  },
};

export default rule;
