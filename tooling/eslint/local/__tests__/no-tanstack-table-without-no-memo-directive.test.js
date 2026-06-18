/**
 * Tests for the `no-tanstack-table-without-no-memo-directive` rule.
 *
 * This rule is currently "off" in the shared configs — enable it when the
 * React Compiler is adopted. The tests ensure the logic is correct so it's
 * ready to turn on without surprises.
 *
 * RuleTester throws on any failed assertion; the vitest `it` is the
 * test-registration hook required by vitest.
 */
import { RuleTester } from "eslint";
import { describe, expect, it } from "vitest";

import rule from "../no-tanstack-table-without-no-memo-directive.js";

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    parserOptions: {
      ecmaFeatures: { jsx: true },
    },
  },
});

ruleTester.run("no-tanstack-table-without-no-memo-directive", rule, {
  valid: [
    // Function with the directive — passes.
    {
      code: `function MyTable() {
  "use no memo";
  const rows = table.getRowModel().rows;
  return rows;
}`,
    },
    // Function that doesn't touch TanStack Table — passes.
    {
      code: `function Greeting({ name }) {
  return name;
}`,
    },
    // Inline arrow inside an opted-out parent — passes (inherits directive).
    // Regression guard: the rule must NOT fire on onClick arrows inside an
    // already-safe component (the early auto-fix would insert directives inside
    // arrow bodies that were never reachable to memoise).
    {
      code: `function Header({ column }) {
  "use no memo";
  return (
    <button onClick={() => column.toggleSorting(false)}>
      Sort
    </button>
  );
}`,
    },
  ],

  invalid: [
    // table.getRowModel() without directive.
    {
      code: `function MyTable({ table }) {
  const rows = table.getRowModel().rows;
  return rows;
}`,
      errors: [{ messageId: "missing" }],
      output: `function MyTable({ table }) {
  "use no memo";

  const rows = table.getRowModel().rows;
  return rows;
}`,
    },
    // column.getIsSorted() without directive — the symptom from the sort-toggle stale bug.
    {
      code: `function Header({ column }) {
  const isSorted = column.getIsSorted();
  return isSorted;
}`,
      errors: [{ messageId: "missing" }],
      output: `function Header({ column }) {
  "use no memo";

  const isSorted = column.getIsSorted();
  return isSorted;
}`,
    },
    // Arrow function — auto-fix should still apply at the body opening brace.
    {
      code: `const Pagination = ({ table }) => {
  const groups = table.getHeaderGroups();
  return groups;
};`,
      errors: [{ messageId: "missing" }],
      output: `const Pagination = ({ table }) => {
  "use no memo";

  const groups = table.getHeaderGroups();
  return groups;
};`,
    },
  ],
});

describe("no-tanstack-table-without-no-memo-directive", () => {
  it("rule tester completed without throwing", () => {
    expect(true).toBe(true);
  });
});
