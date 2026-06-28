/**
 * Custom ESLint rule: `no-raw-field-error-message`.
 *
 * Bans rendering a react-hook-form field error message raw in JSX —
 * `{errors.email.message}`, `{addErrors.measuredOn.message}` — and requires the
 * shared `<FieldError error={errors.email} />` component instead.
 *
 * Why: validation messages must render through the i18n seam. The zod
 * error-map (`@repo/i18n` `createZodErrorMap`) is wired once at app boot
 * (`z.config`), which localizes generic-code messages (invalid type / too small
 * / too big / format). `<FieldError>` is the single sanctioned sink: it carries
 * `role="alert"` for a11y and is the one place that render path lives, so the
 * styling/markup can't drift across forms. A raw `{errors.x.message}` render
 * bypasses that seam and re-introduces the i18n-leak class.
 *
 * What it matches: a MemberExpression `<obj>.<field>.message`, rendered inside a
 * JSX expression container, whose root object is an identifier ending in
 * `errors`/`Errors` (the react-hook-form `formState.errors` object, usually
 * destructured as `errors`, or renamed like `addErrors`). It deliberately does
 * NOT match `mutation.error.message` (TanStack mutation error — a legitimate
 * raw render) or `toast.message` (root is not an `errors` object); those are a
 * different concern. Controller render-prop `fieldState.error.message` is not
 * auto-caught — route it through `<FieldError>` by convention.
 *
 * Rule options: none.
 */

const ERRORS_OBJECT = /[Ee]rrors$/;

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Rendering a react-hook-form field error raw (`{errors.x.message}`) is banned. Use the shared `<FieldError error={errors.x} />` so messages go through the i18n-wired error-map and the a11y sink.",
    },
    schema: [],
    messages: {
      raw: "Render field errors through `<FieldError error={...} />` (from @repo/ui on web, ./field-error on mobile), not a raw `{….message}`. The shared component is the i18n-aware sink; a raw render bypasses the wired zod error-map.",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    return {
      MemberExpression(node) {
        // Match `.message` (non-computed).
        if (
          node.computed ||
          node.property.type !== "Identifier" ||
          node.property.name !== "message"
        ) {
          return;
        }
        // ...whose object is itself a member access `<obj>.<field>`...
        const fieldAccess = node.object;
        if (fieldAccess.type !== "MemberExpression") return;
        // ...rooted at an identifier named like the RHF errors object.
        const root = fieldAccess.object;
        if (root.type !== "Identifier" || !ERRORS_OBJECT.test(root.name)) return;
        // Only flag RENDERED occurrences — a `.message` read in plain logic is fine.
        const inJsx = sourceCode
          .getAncestors(node)
          .some((ancestor) => ancestor.type === "JSXExpressionContainer");
        if (!inJsx) return;
        context.report({ node, messageId: "raw" });
      },
    };
  },
};

export default rule;
