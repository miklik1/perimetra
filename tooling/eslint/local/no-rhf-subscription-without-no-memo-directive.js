/**
 * Custom ESLint rule: `no-rhf-subscription-without-no-memo-directive`.
 *
 * React Hook Form's `useFormState`, `useWatch`, and `useController` hooks
 * subscribe to the form's internal state via a Proxy-based mechanism that
 * mutates in place. The React Compiler can't see through that mutation and
 * therefore caches stale values across renders — when the compiler decides a
 * component's props are stable, it skips the component body entirely on
 * subsequent renders, which means the subscription hook never runs and never
 * receives updates. The visible bug shape is "form errors don't clear when the
 * user types a valid value" or "watched field freezes after the first render."
 *
 * The escape hatch is the `"use no memo"` directive at the top of any function
 * that calls one of these hooks. Forgetting it causes inline errors to never
 * clear on input and watched fields to freeze — a latent bug class that has
 * appeared in multiple codebases adopting the React Compiler.
 *
 * This rule mirrors `no-tanstack-table-without-no-memo-directive` — the
 * underlying React Compiler problem is structurally identical, so the
 * detection logic is identical too. Differences:
 *   - Trigger: direct CallExpression of `useFormState`/`useWatch`/
 *     `useController` (RHF hooks are imported as top-level functions, not
 *     methods on a table object).
 *   - Same scope rules: stops at nested function boundaries; respects
 *     enclosing directive inheritance.
 *
 * It ALSO flags the equivalent `form.watch("name")` METHOD render-read
 * (gated on an object identifier matching /form/i). The watch() method has
 * the same React-Compiler freeze risk, and — worse — in a CHILD component
 * (one receiving `form` via props rather than calling `useForm`) it
 * establishes no re-render subscription at all, so the read silently
 * freezes. The subscription/callback form `form.watch(cb)` (used inside
 * effects) is intentionally NOT flagged — it isn't a render-time read. For
 * child components, prefer migrating to the `useWatch` hook; for the
 * `useForm` host, the method + `"use no memo"` directive is sufficient.
 *
 * **This rule is currently registered as "off" in the shared configs because
 * this skeleton does not yet enable the React Compiler. Enable it in
 * tooling/eslint/next.js, react-internal.js, and expo.js when the React
 * Compiler is adopted. See the commented-out registration in each config.**
 */

const RHF_SUBSCRIPTION_HOOKS = /** @type {const} */ (["useFormState", "useWatch", "useController"]);

/** Heuristic: is `node` a function (arrow/expression)?  The `form.watch(cb)`
 * subscription form passes a callback and is a legitimate effect-time API,
 * not a render-time read — exclude it. */
function isFunctionArg(node) {
  return !!node && (node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression");
}

/** Does this CallExpression read `<form>.watch(<non-callback>)` at render
 * time? Object must be an identifier whose name looks like a form handle. */
function isWatchMethodRenderRead(node) {
  return (
    node.type === "CallExpression" &&
    node.callee?.type === "MemberExpression" &&
    node.callee.property?.type === "Identifier" &&
    node.callee.property.name === "watch" &&
    node.callee.object?.type === "Identifier" &&
    /form/i.test(node.callee.object.name) &&
    !isFunctionArg(node.arguments?.[0])
  );
}

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        'Functions calling React Hook Form subscription hooks (`useFormState`, `useWatch`, `useController`) or the `form.watch("name")` render-read method must begin with `"use no memo"` so the React Compiler does not skip re-execution on form-state mutations.',
    },
    fixable: "code",
    schema: [],
    messages: {
      missing:
        "Functions reading RHF form state at render (the `useFormState`/`useWatch`/`useController` " +
        'hooks, or a `form.watch("name")` method read) must start with `"use no memo"`. ' +
        "Without it, the React Compiler memoises the component on its stable props and the read " +
        "never re-runs when form state mutates — inline errors stall, watched values freeze. " +
        "Add the directive as the first statement of the function body. " +
        "Note: in a CHILD component (one receiving `form` via props), the `form.watch()` method " +
        "establishes no subscription at all — prefer the `useWatch` hook there.",
    },
  },
  create(context) {
    /**
     * Walk a function body for direct RHF subscription-hook calls — i.e.
     * calls that run DURING this function's render. Nested function
     * boundaries terminate the descent so event-handler arrows don't
     * falsely flag the parent component.
     */
    function callsRhfSubscriptionHook(fnNode) {
      let found = false;
      const visit = (node, isRoot) => {
        if (found || !node || typeof node !== "object") return;
        if (
          !isRoot &&
          (node.type === "FunctionDeclaration" ||
            node.type === "FunctionExpression" ||
            node.type === "ArrowFunctionExpression")
        ) {
          return;
        }
        if (
          node.type === "CallExpression" &&
          node.callee?.type === "Identifier" &&
          RHF_SUBSCRIPTION_HOOKS.includes(node.callee.name)
        ) {
          found = true;
          return;
        }
        if (isWatchMethodRenderRead(node)) {
          found = true;
          return;
        }
        for (const key of Object.keys(node)) {
          const child = node[key];
          if (key === "parent") continue;
          if (Array.isArray(child)) child.forEach((c) => visit(c, false));
          else if (child && typeof child === "object") visit(child, false);
        }
      };
      visit(fnNode.body, true);
      return found;
    }

    function hasUseNoMemoDirective(fnNode) {
      const body = fnNode.body;
      if (!body || body.type !== "BlockStatement") return false;
      for (const stmt of body.body) {
        if (stmt.type !== "ExpressionStatement") break;
        const expr = stmt.expression;
        if (
          expr.type === "Literal" &&
          typeof expr.value === "string" &&
          expr.value === "use no memo"
        ) {
          return true;
        }
        if (!(expr.type === "Literal" && typeof expr.value === "string")) {
          break;
        }
      }
      return false;
    }

    /**
     * Walk up the AST from `fnNode` to see whether any enclosing function
     * already carries `"use no memo"`. Same inheritance semantics as
     * `no-tanstack-table-without-no-memo-directive`.
     */
    function enclosingFunctionHasDirective(fnNode) {
      let parent = fnNode.parent;
      while (parent) {
        if (
          parent.type === "FunctionDeclaration" ||
          parent.type === "FunctionExpression" ||
          parent.type === "ArrowFunctionExpression"
        ) {
          if (
            parent.body &&
            parent.body.type === "BlockStatement" &&
            hasUseNoMemoDirective(parent)
          ) {
            return true;
          }
        }
        parent = parent.parent;
      }
      return false;
    }

    function checkFunction(fnNode) {
      if (!fnNode.body || fnNode.body.type !== "BlockStatement") return;
      if (!callsRhfSubscriptionHook(fnNode)) return;
      if (hasUseNoMemoDirective(fnNode)) return;
      if (enclosingFunctionHasDirective(fnNode)) return;

      context.report({
        node: fnNode,
        messageId: "missing",
        fix(fixer) {
          const sourceCode = context.sourceCode ?? context.getSourceCode();
          const openBrace = sourceCode.getFirstToken(fnNode.body);
          if (!openBrace) return null;
          return fixer.insertTextAfter(openBrace, '\n  "use no memo";\n');
        },
      });
    }

    return {
      FunctionDeclaration: checkFunction,
      FunctionExpression: checkFunction,
      ArrowFunctionExpression: checkFunction,
    };
  },
};

export default rule;
