/**
 * Tests for the `no-rhf-reset-in-modal-useeffect` rule.
 *
 * RuleTester throws on any failed assertion; the vitest `it` is the
 * test-registration hook required by vitest.
 */
import { RuleTester } from "eslint";
import { describe, expect, it } from "vitest";

import rule from "../no-rhf-reset-in-modal-useeffect.js";

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    parserOptions: {
      ecmaFeatures: { jsx: true },
    },
  },
});

ruleTester.run("no-rhf-reset-in-modal-useeffect", rule, {
  valid: [
    // Mount-time useMemo defaults — the canonical replacement pattern.
    {
      code: `function EditModal({ item }) {
  const initialDefaults = useMemo(
    () => (item ? toFormValues(item) : defaultValues),
    []
  );
  const { reset } = useForm({ defaultValues: initialDefaults });
  return null;
}`,
    },
    // RHF reset() inside a mutation callback (post-event, not commit-phase).
    {
      code: `function Form() {
  const { reset } = useForm();
  const onSubmit = () => {
    mutate(data, { onSuccess: () => reset() });
  };
  return null;
}`,
    },
    // RHF reset() inside a render-time handler — not inside useEffect.
    {
      code: `function Form() {
  const { reset } = useForm();
  const handleClose = () => {
    reset();
  };
  return null;
}`,
    },
    // useEffect that calls something other than reset — not flagged.
    {
      code: `function Form() {
  useEffect(() => {
    setValue("x", 1);
  }, []);
  return null;
}`,
    },
    // Escape-hatch directive opt-out for non-modal forms that legitimately
    // need to re-seed mid-lifecycle.
    {
      code: `function AsyncDataForm() {
  "rhf reset is intentional";
  const { reset } = useForm();
  useEffect(() => {
    reset(values);
  }, [values]);
  return null;
}`,
    },
    // Local useCallback reset — NOT RHF. Rule must not fire.
    // (Regression guard for Zustand / local-state `reset` callback false-positive.)
    {
      code: `function ExportWidget() {
  const reset = useCallback(() => {
    setStage("idle");
    setProgress(0);
  }, []);
  useEffect(() => {
    if (cancelled) reset();
  }, [cancelled, reset]);
  return null;
}`,
    },
    // Zustand store action named `reset` called from useEffect — not RHF.
    {
      code: `function MyComponent() {
  const reset = useStore((s) => s.reset);
  useEffect(() => {
    reset();
  }, []);
  return null;
}`,
    },
    // Indirect RHF binding through an intermediate variable — RHF but called
    // only inside a handler (not useEffect), so still valid.
    {
      code: `function Form() {
  const form = useForm();
  const { reset } = form;
  const handleClick = () => reset();
  return null;
}`,
    },
  ],

  invalid: [
    // The canonical anti-pattern: useEffect(() => reset(values)) with `reset`
    // destructured from useForm.
    {
      code: `function EditModal({ item }) {
  const { reset } = useForm();
  useEffect(() => {
    if (item) reset(toFormValues(item));
  }, [item, reset]);
  return null;
}`,
      errors: [{ messageId: "resetInEffect" }],
    },
    // useLayoutEffect variant — same bug class, commit-phase timing.
    {
      code: `function Form() {
  const { reset } = useForm();
  useLayoutEffect(() => {
    reset();
  }, []);
  return null;
}`,
      errors: [{ messageId: "resetInEffect" }],
    },
    // RHF reset() nested inside a callback within useEffect — still gets the race.
    {
      code: `function Form() {
  const { reset } = useForm();
  useEffect(() => {
    setTimeout(() => reset(), 100);
  }, []);
  return null;
}`,
      errors: [{ messageId: "resetInEffect" }],
    },
    // Conditional reset — still wipes _fields when the branch fires.
    {
      code: `function ConditionalForm({ shouldReset }) {
  const { reset } = useForm();
  useEffect(() => {
    if (shouldReset) {
      reset({ name: "" });
    }
  }, [shouldReset]);
  return null;
}`,
      errors: [{ messageId: "resetInEffect" }],
    },
    // Function expression callback (not arrow) — still detected.
    {
      code: `function Form() {
  const { reset } = useForm();
  useEffect(function () {
    reset();
  }, []);
  return null;
}`,
      errors: [{ messageId: "resetInEffect" }],
    },
    // useZodForm variant — same hook family, same flagging.
    {
      code: `function Form() {
  const { reset } = useZodForm(schema);
  useEffect(() => {
    reset(values);
  }, [values]);
  return null;
}`,
      errors: [{ messageId: "resetInEffect" }],
    },
    // Indirect binding via intermediate variable — `const { reset } = form`
    // where `form` came from a hook. Still detected.
    {
      code: `function Form() {
  const form = useForm();
  const { reset } = form;
  useEffect(() => {
    reset();
  }, []);
  return null;
}`,
      errors: [{ messageId: "resetInEffect" }],
    },
  ],
});

describe("no-rhf-reset-in-modal-useeffect", () => {
  it("rule tester completed without throwing", () => {
    expect(true).toBe(true);
  });
});
