/**
 * Custom ESLint rule: `no-tanstack-table-without-no-memo-directive`.
 *
 * TanStack Table v8 returns mutation-based instances — `useReactTable`
 * preserves the same `table` reference across renders while internal state
 * is mutated. The React Compiler can't see through that mutation and therefore
 * caches downstream values (notably `table.getRowModel()` and
 * `column.getIsSorted()`) based on the stable `table`/`column` references.
 * The visible bug shape is "the table data updates upstream but the rendered
 * DOM stays stale" or "click handlers read stale `isSorted`."
 *
 * The escape hatch is the `"use no memo"` directive at the top of any function
 * that touches the mutation API. Forgetting it is the bug class that surfaces
 * on table compound components and column-header components once the React
 * Compiler is adopted.
 *
 * **This rule is currently registered as "off" in the shared configs because
 * this skeleton does not yet enable the React Compiler. Enable it in
 * tooling/eslint/next.js, react-internal.js, and expo.js when the React
 * Compiler is adopted (add `reactCompiler: true` to the Next/Babel config).
 * See the commented-out registration in each config file.**
 *
 * The rule is intentionally specific. False positives in the wild should be
 * diagnosed and either: (a) confirmed as compiler-incompatible (add the
 * directive — the rule is right), or (b) refactored to not touch the
 * mutation API (the right long-term fix).
 */

const MUTATION_METHODS = /** @type {const} */ ([
  "getRowModel",
  "getHeaderGroups",
  "getAllColumns",
  "getAllFlatColumns",
  "getAllLeafColumns",
  "getFilteredSelectedRowModel",
  "getSelectedRowModel",
  "getCanSort",
  "getIsSorted",
  "getCanHide",
  "getIsVisible",
  "toggleSorting",
  "clearSorting",
  "toggleVisibility",
  "toggleSelected",
  "getIsSelected",
]);

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        'Functions touching TanStack Table\'s mutation-based API must begin with `"use no memo"` so the React Compiler does not cache stale values across mutations.',
    },
    fixable: "code",
    schema: [],
    messages: {
      missing:
        "Functions calling TanStack Table mutation APIs (e.g. `table.getRowModel()`, " +
        '`column.getIsSorted()`) must start with `"use no memo"`. ' +
        "Add the directive as the first statement of the function body. " +
        "Without it, the React Compiler caches the return value against the stable table/column " +
        "reference and the rendered output goes stale when internal table state mutates.",
    },
  },
  create(context) {
    /**
     * Walk a function body for direct mutation-API calls — i.e. calls in
     * code that runs DURING this function's render, not in nested functions
     * like inline event-handler arrows. The React Compiler only memoises
     * values produced during render; calls fired at runtime
     * (`onClick={() => column.toggleSorting()}`) are unaffected and don't
     * need the directive.
     *
     * Implementation: AST walk that stops descending at nested function
     * boundaries.
     */
    function callsMutationApi(fnNode) {
      let found = false;
      const visit = (node, isRoot) => {
        if (found || !node || typeof node !== "object") return;
        // Stop at nested functions (the rule visits them separately).
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
          node.callee?.type === "MemberExpression" &&
          node.callee.property?.type === "Identifier" &&
          MUTATION_METHODS.includes(node.callee.property.name)
        ) {
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
        // Directives are string literals at the start of a function body.
        const expr = stmt.expression;
        if (
          expr.type === "Literal" &&
          typeof expr.value === "string" &&
          expr.value === "use no memo"
        ) {
          return true;
        }
        // Stop scanning after the first non-directive statement — directives
        // must be at the head of the function body to be valid.
        if (!(expr.type === "Literal" && typeof expr.value === "string")) {
          break;
        }
      }
      return false;
    }

    /**
     * Walk up the AST from `fnNode` to see whether any enclosing function
     * already carries `"use no memo"`. The directive is inherited by every
     * function nested inside it (the React Compiler stops transforming the
     * outer function and therefore stops transforming everything inside it).
     * Without this check the rule fires on every inline JSX arrow
     * (`onClick={() => column.toggleSorting()}`) inside an already opted-out
     * component, which is noise — the auto-fix would also corrupt the code
     * by inserting directives inside arrow bodies that were never reachable
     * to memoise in the first place.
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
      if (!callsMutationApi(fnNode)) return;
      if (hasUseNoMemoDirective(fnNode)) return;
      if (enclosingFunctionHasDirective(fnNode)) return;

      context.report({
        node: fnNode,
        messageId: "missing",
        fix(fixer) {
          const sourceCode = context.sourceCode ?? context.getSourceCode();
          // Insert `"use no memo";\n` immediately after the opening brace
          // of the function body. The leading newline keeps existing
          // indentation intact even when the body is on one line.
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
