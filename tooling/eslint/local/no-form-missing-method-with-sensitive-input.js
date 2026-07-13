/**
 * Custom ESLint rule: `no-form-missing-method-with-sensitive-input`.
 *
 * Requires `method="post"` on any `<form>` that contains a secret- or
 * PII-bearing named input. This is the class rule ADR 1001's own follow-up
 * proposed — broadened from ADR 1001's literal `type="password"`-only text to
 * every secret/PII-bearing field (ADR 1005).
 *
 * Why: a `<form>`'s default method is GET. A submit that lands BEFORE React
 * hydrates falls back to the browser's native submit, GET-serialising every
 * NAMED control into the URL — and from there into browser history, the
 * Referer header, and the access logs of every hop. react-hook-form's
 * `register("x")` spread attaches `name="x"` to the rendered input, so it arms
 * exactly the fields carrying user data; an `onSubmit` handler does NOT protect
 * the pre-hydration window — only `method="post"` does.
 *
 * What it flags: a `<form>` whose `method` is absent or a literal other than
 * "post" (case-insensitive) AND which contains at least one descendant carrying
 *   - a literal `type="password"` (always secret — ADR 1001's literal case), OR
 *   - a name matching the sensitive-field vocabulary, taken from either a
 *     literal `name="email"` attribute OR a `{...register("email")}` spread
 *     whose argument is a string literal.
 *
 * Matching is by ATTRIBUTE, not tag name, so it catches both a native
 * `<input {...register("email")} />` and a custom `<Input {...register(...)} />`
 * wrapper (the common RHF pattern). Sensitivity is: an always-checked STRONG
 * substring set (tokens that essentially never appear innocuously, e.g.
 * `email`, `ssn`, `creditCard`) plus an exact-match list (`piiFieldNames`,
 * overridable per project).
 *
 * Blind spots (deliberate conservative under-flag, matching the house style of
 * the other local RHF rules; stated so they aren't mistaken for coverage):
 *   - A dynamic `method={expr}` is treated as satisfied — the rule cannot prove
 *     it is not "post".
 *   - A dynamic `register(fieldNameVar)` argument cannot be resolved statically,
 *     so it is ignored (no flag).
 *   - `<Controller render={({ field }) => <Input {...field} />} />` exposes the
 *     field name at runtime, not as a static `register("x")` call, so a
 *     Controller-wrapped PII input is not seen. Route it through a `method`ed
 *     form by convention.
 *   - The bare token `name` is excluded from the default list — a person's name
 *     (PII) and a project's name (not PII) are indistinguishable at the
 *     identifier level; favour the unambiguous tokens.
 *
 * Rule options: `{ piiFieldNames?: string[] }` — REPLACES the default
 * exact-match list. The STRONG substring set is a security floor and always
 * applies, override or not.
 */

/** Tokens so specific they are matched anywhere inside a field name (substring). */
const STRONG_TOKENS = [
  "email",
  "password",
  "ssn",
  "creditcard",
  "cardnumber",
  "cvv",
  "cvc",
  "iban",
  "passport",
  "taxid",
  "nationalid",
  "apikey",
];

/** Exact-match vocabulary (normalised). Overridable via the `piiFieldNames` option. */
const DEFAULT_PII_FIELD_NAMES = [
  "email",
  "phone",
  "phonenumber",
  "tel",
  "mobile",
  "ssn",
  "dob",
  "dateofbirth",
  "birthdate",
  "address",
  "street",
  "postalcode",
  "zip",
  "zipcode",
  "creditcard",
  "cardnumber",
  "cvv",
  "cvc",
  "taxid",
  "nationalid",
  "passport",
  "iban",
  "pin",
  "apikey",
  "apisecret",
  "secret",
  "token",
  "password",
];

/** Lowercase and strip separators so `date_of_birth`/`dateOfBirth` both normalise equal. */
function normalize(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function isSensitiveName(name, exactList) {
  const n = normalize(name);
  if (!n) return false;
  if (exactList.includes(n)) return true;
  return STRONG_TOKENS.some((t) => n.includes(t));
}

function isFormOpening(openingEl) {
  return openingEl.name.type === "JSXIdentifier" && openingEl.name.name === "form";
}

/**
 * The static string value of a JSX attribute value, or null if it cannot be
 * resolved. Handles BOTH `x="y"` (a Literal) and `x={"y"}` (a
 * JSXExpressionContainer wrapping a string Literal) — the braced form is an
 * ordinary JSX styling choice, NOT a genuinely dynamic value, so it must not
 * slip through as "unresolvable" (that was a rule bypass: `method={"get"}`).
 * A genuinely dynamic expression (`method={fn()}`, `name={x}`) returns null.
 */
function staticStringValue(value) {
  if (!value) return null;
  if (value.type === "Literal" && typeof value.value === "string") return value.value;
  if (
    value.type === "JSXExpressionContainer" &&
    value.expression.type === "Literal" &&
    typeof value.expression.value === "string"
  ) {
    return value.expression.value;
  }
  return null;
}

/**
 * A form is compliant iff it carries a statically-known `method` (whether
 * written `method="post"` or `method={"post"}`) case-insensitively equal to
 * "post". Missing or a statically-known non-post → not compliant. A genuinely
 * dynamic `method={expr}` is unresolvable → treated as compliant (conservative;
 * cannot prove otherwise).
 */
function hasPostMethod(openingEl) {
  for (const attr of openingEl.attributes) {
    if (attr.type !== "JSXAttribute" || attr.name.type !== "JSXIdentifier") continue;
    if (attr.name.name !== "method") continue;
    const method = staticStringValue(attr.value);
    if (method === null) return true; // genuinely dynamic → conservative pass
    return method.toLowerCase() === "post";
  }
  return false; // no method attribute → native GET default
}

/** True if this opening element carries a sensitive input attribute. */
function isSensitiveInput(openingEl, exactList) {
  for (const attr of openingEl.attributes) {
    if (attr.type === "JSXSpreadAttribute") {
      // {...register("email")}
      const arg = attr.argument;
      if (
        arg &&
        arg.type === "CallExpression" &&
        arg.callee.type === "Identifier" &&
        arg.callee.name === "register" &&
        arg.arguments.length > 0 &&
        arg.arguments[0].type === "Literal" &&
        typeof arg.arguments[0].value === "string" &&
        isSensitiveName(arg.arguments[0].value, exactList)
      ) {
        return true;
      }
      continue;
    }
    if (attr.type !== "JSXAttribute" || attr.name.type !== "JSXIdentifier") continue;
    // type="password" / type={"password"} — always secret.
    if (attr.name.name === "type") {
      const type = staticStringValue(attr.value);
      if (type !== null && type.toLowerCase() === "password") return true;
    }
    // name="email" / name={"email"} — literal name attribute.
    if (attr.name.name === "name") {
      const fieldName = staticStringValue(attr.value);
      if (fieldName !== null && isSensitiveName(fieldName, exactList)) return true;
    }
  }
  return false;
}

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        'Requires `method="post"` on any `<form>` containing a secret- or PII-bearing named input. A pre-hydration native submit of a GET form serialises the field into the URL/history/Referer/logs (ADR 1001/1005).',
    },
    schema: [
      {
        type: "object",
        properties: {
          piiFieldNames: {
            type: "array",
            items: { type: "string" },
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      missingMethod:
        'This <form> contains a secret- or PII-bearing named input but no `method="post"`. A submit before hydration falls back to the native GET, serialising the field into the URL, history, the Referer header, and access logs (ADR 1001/1005). Add `method="post"`.',
    },
  },
  create(context) {
    const options = context.options[0] ?? {};
    const exactList = (options.piiFieldNames ?? DEFAULT_PII_FIELD_NAMES).map(normalize);
    /** @type {{ node: import("eslint").Rule.Node, compliant: boolean, sensitive: boolean }[]} */
    const stack = [];

    return {
      JSXElement(node) {
        if (isFormOpening(node.openingElement)) {
          stack.push({
            node: node.openingElement,
            compliant: hasPostMethod(node.openingElement),
            sensitive: false,
          });
        }
      },
      JSXOpeningElement(node) {
        if (stack.length === 0) return;
        // Skip a `<form>`'s OWN opening element — only descendant controls count.
        // A form's legacy `name` attribute (`<form name="passwordResetForm">`) is
        // not a serialising control, so it must not self-trigger the rule.
        if (isFormOpening(node)) return;
        if (isSensitiveInput(node, exactList)) {
          stack[stack.length - 1].sensitive = true;
        }
      },
      "JSXElement:exit"(node) {
        if (!isFormOpening(node.openingElement)) return;
        const rec = stack.pop();
        if (rec && rec.sensitive && !rec.compliant) {
          context.report({ node: rec.node, messageId: "missingMethod" });
        }
      },
    };
  },
};

export default rule;
