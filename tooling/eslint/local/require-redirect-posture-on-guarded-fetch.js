/**
 * Custom ESLint rule: `require-redirect-posture-on-guarded-fetch`.
 *
 * Requires an EXPLICIT `redirect` posture on every `fetch` in a module that
 * uses the SSRF egress guard, and on every `fetch` that attaches a `dispatcher`.
 *
 * Why (vault finding: "A guarded egress that follows redirects re-opens the
 * SSRF hole its pre-flight closed"): the two guard layers validate the URL the
 * CALLER chose. `fetch`'s default is `redirect: "follow"`, so the destination
 * the socket finally reaches is one the TARGET chose. Layer 1 has already run,
 * on the original URL; layer 2's connector CANNOT re-validate an IP literal,
 * because undici skips DNS resolution entirely when no lookup is needed. A
 * subscriber answering `302 Location: http://169.254.169.254/latest/meta-data/`
 * therefore walks a fully-guarded caller straight into the cloud metadata
 * service, carrying whatever credential or signature the request was built
 * with. Neither layer is buggy — redirect-following changes the URL AFTER they
 * run, which is outside the model.
 *
 * The rule does not pick the posture, it only refuses SILENCE. Both answers are
 * accepted, because which one is right is a per-call-site judgement:
 *   - `redirect: "error"` / `"manual"` + refuse the hop — right wherever
 *     redirects have no legitimate role (a machine-to-machine ingest endpoint).
 *   - `redirect: "manual"` + follow by hand, re-running the full pre-flight on
 *     every resolved `Location` and capping the hop count — right where
 *     redirects are genuinely expected (customer-supplied webhook URLs).
 * What is never right is inheriting `"follow"` by saying nothing, which is
 * exactly what the next call site does if nothing forces the choice. A fixed
 * call site with no forcing function is one refactor from regressing.
 *
 * What it flags, in a file that imports from the guard module (default: a
 * specifier ending in `ssrf-guard`, `ssrf-guard.js` or `ssrf-guard.ts`) OR at
 * any `fetch` whose init attaches a `dispatcher`:
 *   - `fetch(url)` — no init at all, so the default `"follow"` applies;
 *   - `fetch(url, { ... })` — an init object with no `redirect` property;
 *   - `fetch(url, init)` where `init` resolves, in scope, to an object
 *     expression with no `redirect` property (the common
 *     "build the init above, call below" shape — resolving it is what makes the
 *     rule bite on the real call site rather than only on inline literals).
 *
 * Blind spots (deliberate conservative under-flag, stated so they are not
 * mistaken for coverage):
 *   - An init that cannot be resolved to an object expression (a function
 *     parameter, a call result, an import) is NOT flagged — the rule cannot
 *     prove the property is absent.
 *   - An init carrying a spread (`{ ...base }`) with no own `redirect` is NOT
 *     flagged; the property may come from the spread.
 *   - A wrapper (`myHttp(url)`) that calls `fetch` in another module is not
 *     seen from here. Guard modules are small; keep the `fetch` in them.
 *
 * Rule options: `{ guardModulePattern?: string }` — a RegExp source matched
 * against import specifiers to decide whether a module is a guarded-egress
 * module. Replaces the default.
 */

const DEFAULT_GUARD_MODULE_PATTERN = "(^|/)ssrf-guard(\\.[jt]s)?$";

/** `fetch(...)` or `globalThis.fetch(...)` / `global.fetch(...)`. */
function isFetchCall(node) {
  const callee = node.callee;
  if (callee.type === "Identifier") return callee.name === "fetch";
  if (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.property.type === "Identifier" &&
    callee.property.name === "fetch" &&
    callee.object.type === "Identifier"
  ) {
    return callee.object.name === "globalThis" || callee.object.name === "global";
  }
  return false;
}

/** True if the object expression has an OWN property with this name. */
function hasOwnProperty(objectExpression, name) {
  return objectExpression.properties.some(
    (p) =>
      p.type === "Property" &&
      !p.computed &&
      ((p.key.type === "Identifier" && p.key.name === name) ||
        (p.key.type === "Literal" && p.key.value === name)),
  );
}

function hasSpread(objectExpression) {
  return objectExpression.properties.some((p) => p.type === "SpreadElement");
}

/**
 * Resolve an init argument to the ObjectExpression it denotes, or null.
 * Handles the literal form and a `const init = { … }` / `let init = { … }`
 * binding in scope whose declaration is the only write we can see.
 */
function resolveInitObject(node, scope) {
  if (node.type === "ObjectExpression") return node;
  if (node.type !== "Identifier") return null;
  let current = scope;
  while (current) {
    const variable = current.variables.find((v) => v.name === node.name);
    if (variable) {
      const withInit = variable.defs.find(
        (d) => d.type === "Variable" && d.node.init && d.node.init.type === "ObjectExpression",
      );
      return withInit ? withInit.node.init : null;
    }
    current = current.upper;
  }
  return null;
}

/**
 * A `dispatcher` attached AFTER construction — the shape a codebase reaches for
 * when `RequestInit`'s type does not carry undici's extension:
 * `(init as Record<string, unknown>).dispatcher = agent`.
 */
function isDispatcherAssignment(node) {
  return (
    node.type === "AssignmentExpression" &&
    node.left.type === "MemberExpression" &&
    !node.left.computed &&
    node.left.property.type === "Identifier" &&
    node.left.property.name === "dispatcher"
  );
}

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        'Requires an explicit `redirect` posture on any fetch that goes through the SSRF egress guard. Inheriting fetch\'s default `redirect: "follow"` lets the TARGET choose the final destination, which neither guard layer sees.',
    },
    schema: [
      {
        type: "object",
        properties: { guardModulePattern: { type: "string" } },
        additionalProperties: false,
      },
    ],
    messages: {
      missingPosture:
        'This fetch goes through the SSRF egress guard but sets no `redirect` posture, so it inherits fetch\'s default `redirect: "follow"`. The TARGET then chooses the final destination and NEITHER guard layer sees the hop — an IP-literal `Location` is invisible to the DNS-validating connector. Set `redirect: "error"`/`"manual"` and either refuse the hop or re-run the full pre-flight on every resolved Location.',
    },
  },
  create(context) {
    const options = context.options[0] ?? {};
    const guardModulePattern = new RegExp(
      options.guardModulePattern ?? DEFAULT_GUARD_MODULE_PATTERN,
    );
    const sourceCode = context.sourceCode ?? context.getSourceCode();

    let importsGuardModule = false;
    /** Fetch calls seen before we could know whether the file is a guard consumer. */
    const pending = [];
    /** True once any `x.dispatcher = …` assignment is seen in this file. */
    let assignsDispatcher = false;

    function initObjectFor(node) {
      if (node.arguments.length < 2) return undefined;
      const scope = sourceCode.getScope ? sourceCode.getScope(node) : context.getScope();
      return resolveInitObject(node.arguments[1], scope) ?? undefined;
    }

    function verdict(node) {
      const init = initObjectFor(node);
      // No init argument at all → the default `"follow"` applies verbatim.
      if (node.arguments.length < 2) return "report";
      // An init we cannot resolve to an object literal → cannot prove absence.
      if (!init) return "skip";
      if (hasOwnProperty(init, "redirect")) return "ok";
      if (hasSpread(init)) return "skip";
      return "report";
    }

    function attachesDispatcher(node) {
      const init = initObjectFor(node);
      return Boolean(init && hasOwnProperty(init, "dispatcher"));
    }

    return {
      ImportDeclaration(node) {
        if (guardModulePattern.test(node.source.value)) importsGuardModule = true;
      },
      AssignmentExpression(node) {
        if (isDispatcherAssignment(node)) assignsDispatcher = true;
      },
      CallExpression(node) {
        if (!isFetchCall(node)) return;
        // A dispatcher on the init is guarded-egress evidence on its own, even
        // in a module that imports no guard (an out-of-tree guard, a project's
        // own connector).
        if (attachesDispatcher(node)) {
          if (verdict(node) === "report") context.report({ node, messageId: "missingPosture" });
          return;
        }
        pending.push(node);
      },
      "Program:exit"() {
        if (!importsGuardModule && !assignsDispatcher) return;
        for (const node of pending) {
          if (verdict(node) === "report") context.report({ node, messageId: "missingPosture" });
        }
      },
    };
  },
};

export default rule;
