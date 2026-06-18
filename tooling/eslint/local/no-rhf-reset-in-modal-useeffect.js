/**
 * Custom ESLint rule: `no-rhf-reset-in-modal-useeffect`.
 *
 * React Hook Form's `reset()` unconditionally clears the form's internal
 * `_fields` registry (see `node_modules/react-hook-form/dist/index.esm.mjs`
 * `_reset`). After a `reset()`, RHF's imperative DOM-hydration loop has no
 * `_fields[name]` entries to push values into — pre-fill values never reach
 * the rendered inputs, and `register("name").onChange` short-circuits at
 * `if (field) { ... }`, so typing becomes a no-op.
 *
 * That breakage is invisible in any form whose `defaultValues` are stable
 * (e.g. a full-page create form picks defaults at mount and never touches
 * `reset`). It's lethal in modal-pattern dialogs that historically re-seeded
 * the form via `useEffect(() => { reset(values); }, [...])` so the dialog
 * could refresh when the parent flipped `open`. The modal pre-fill bug
 * (blank edit fields, stale errors) traces back to this exact anti-pattern.
 *
 * Modal components that mount fresh per open (keyed by instance id) make the
 * useEffect-and-reset dance unnecessary in the first place. Mount-time
 * `useMemo` of `defaultValues` is the canonical replacement.
 *
 * **Scope discipline.** Identifier-name detection alone is too broad —
 * `reset` is a conventional name for any state-machine teardown callback
 * (Zustand actions, custom `useCallback` reducers, etc.). To avoid false
 * positives on those, this rule narrows to `reset` identifiers that the
 * scope analysis can attribute to a **destructured property of an RHF
 * form hook return** (`useForm`, `useZodForm`, plus `.form` on any
 * hook whose return object is destructured for `reset`). Locally-defined
 * `reset` callbacks unrelated to RHF pass through cleanly.
 *
 * Acceptable patterns (NOT flagged):
 *   - `reset()` from a local `useCallback` / `useState` setter / Zustand
 *     action, regardless of where it's called.
 *   - `reset()` called directly in a render handler or mutation callback
 *     — those don't suffer from the field-registry race because they fire
 *     post-event, not at React's commit phase.
 *   - RHF `reset()` called inside a function whose enclosing function
 *     carries the escape-hatch directive `"rhf reset is intentional"`.
 *     This is the documented opt-out for the rare case where a
 *     non-modal form really does need to re-seed mid-lifecycle (e.g. an
 *     async-loading data source that genuinely needs to repopulate the
 *     form when remote data arrives).
 */

const EFFECT_HOOKS = new Set(["useEffect", "useLayoutEffect"]);
const RESET_IDENTIFIER = "reset";
const ESCAPE_DIRECTIVE = "rhf reset is intentional";

/**
 * Names of hooks that return an object including `reset` from React Hook
 * Form. The destructuring pattern is the signal: `const { reset } = …`.
 */
const RHF_FORM_HOOKS = new Set(["useForm", "useZodForm"]);

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow RHF `reset()` calls inside `useEffect`/`useLayoutEffect` callbacks. The RHF `_reset` wipes the field registry, breaking pre-fill and onChange. Pass `defaultValues` at mount instead (mount-time `useMemo`).",
    },
    schema: [],
    messages: {
      resetInEffect:
        "Avoid `reset()` inside `useEffect`/`useLayoutEffect`. " +
        "RHF's `_reset` clears the field registry (`_fields = {}`), which breaks edit pre-fill " +
        "and inline error clearing in modal forms. " +
        "Use mount-time `useMemo` defaults instead — when a modal mounts fresh per open, " +
        "the defaultValues are evaluated once at mount and never need to be re-seeded via an effect. " +
        "If this is a non-modal form that genuinely needs to re-seed mid-lifecycle, " +
        'add the directive `"rhf reset is intentional";` at the top of the enclosing function body. ' +
        "(Detection is scoped to `reset` destructured from `useForm` / `useZodForm` — " +
        "local `reset` callbacks are not flagged.)",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();

    /**
     * Resolve an identifier name within the given scope to its declaring
     * variable. Walks up the scope chain.
     */
    function resolveVariable(scope, name) {
      let current = scope;
      while (current) {
        const found = current.set?.get?.(name) ?? current.variables?.find((v) => v.name === name);
        if (found) return found;
        current = current.upper;
      }
      return null;
    }

    /**
     * Return true if `name` was declared as a property of an
     * RHF-form-hook return object. Two shapes we care about:
     *
     *   const { reset, ... } = useForm(...);              // direct
     *   const form = useForm(...);                        //
     *   const { reset, ... } = form;                      // indirect
     *
     * Conservative: when the binding can't be statically traced (e.g.
     * `reset` is passed in as a prop), we return false — better to under-
     * flag than fire on unrelated callbacks.
     */
    function isRhfResetBinding(scope, name, depth = 0) {
      if (depth > 3) return false; // bound recursion for `const a = b; const b = …`
      const variable = resolveVariable(scope, name);
      if (!variable) return false;

      for (const def of variable.defs ?? []) {
        if (def.node?.type !== "VariableDeclarator") continue;
        const init = def.node.init;
        if (!init) continue;

        // Direct: `const { reset } = useForm(...)`
        if (init.type === "CallExpression") {
          const callee = init.callee;
          if (callee.type === "Identifier" && RHF_FORM_HOOKS.has(callee.name)) {
            return true;
          }
          continue;
        }

        // Indirect: `const { reset } = form;` — recurse on `form`.
        if (init.type === "Identifier") {
          if (isRhfResetBinding(variable.scope ?? scope, init.name, depth + 1)) {
            return true;
          }
          continue;
        }

        // `const { reset } = useZodForm(...).form` style — match the
        // `.form` member expression bottoming out in a hook call.
        if (init.type === "MemberExpression") {
          let inner = init.object;
          while (inner && inner.type === "MemberExpression") {
            inner = inner.object;
          }
          if (inner?.type === "CallExpression") {
            const callee = inner.callee;
            if (callee.type === "Identifier" && RHF_FORM_HOOKS.has(callee.name)) {
              return true;
            }
          }
          if (inner?.type === "Identifier") {
            if (isRhfResetBinding(variable.scope ?? scope, inner.name, depth + 1)) {
              return true;
            }
          }
        }
      }
      return false;
    }

    /**
     * Walk `node` for direct `reset(...)` CallExpressions whose `reset`
     * identifier resolves to an RHF-destructured binding.
     */
    function callsRhfReset(node) {
      let found = false;
      const visit = (n) => {
        if (found || !n || typeof n !== "object") return;
        if (
          n.type === "CallExpression" &&
          n.callee?.type === "Identifier" &&
          n.callee.name === RESET_IDENTIFIER
        ) {
          const scope = sourceCode.getScope ? sourceCode.getScope(n) : context.getScope();
          if (isRhfResetBinding(scope, RESET_IDENTIFIER)) {
            found = true;
            return;
          }
        }
        for (const key of Object.keys(n)) {
          if (key === "parent") continue;
          const child = n[key];
          if (Array.isArray(child)) child.forEach(visit);
          else if (child && typeof child === "object") visit(child);
        }
      };
      visit(node);
      return found;
    }

    /**
     * Return true if any enclosing function (walking up from `node`) has
     * the `"rhf reset is intentional"` escape-hatch directive.
     */
    function hasEscapeDirective(node) {
      let parent = node.parent;
      while (parent) {
        if (
          (parent.type === "FunctionDeclaration" ||
            parent.type === "FunctionExpression" ||
            parent.type === "ArrowFunctionExpression") &&
          parent.body?.type === "BlockStatement"
        ) {
          for (const stmt of parent.body.body) {
            if (stmt.type !== "ExpressionStatement") break;
            const expr = stmt.expression;
            if (
              expr.type === "Literal" &&
              typeof expr.value === "string" &&
              expr.value === ESCAPE_DIRECTIVE
            ) {
              return true;
            }
            if (!(expr.type === "Literal" && typeof expr.value === "string")) {
              break;
            }
          }
        }
        parent = parent.parent;
      }
      return false;
    }

    return {
      CallExpression(node) {
        if (node.callee?.type !== "Identifier" || !EFFECT_HOOKS.has(node.callee.name)) {
          return;
        }
        const callback = node.arguments[0];
        if (
          !callback ||
          (callback.type !== "ArrowFunctionExpression" && callback.type !== "FunctionExpression")
        ) {
          return;
        }
        if (!callsRhfReset(callback.body)) return;
        if (hasEscapeDirective(node)) return;
        context.report({ node, messageId: "resetInEffect" });
      },
    };
  },
};

export default rule;
