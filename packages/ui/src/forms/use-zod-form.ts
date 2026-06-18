/**
 * Single source of truth for React Hook Form bindings against Zod schemas.
 *
 * `z.input<S>` is what the user types into HTML inputs (e.g. an empty string
 * from a number field, an unparsed date string). `z.output<S>` is what falls
 * out the other side after `preprocess` / `coerce` / `transform` have run —
 * that's what `handleSubmit(onSubmit)` calls `onSubmit` with.
 *
 * The two generics diverge whenever a schema uses `z.coerce`, `z.preprocess`,
 * or `z.transform`. Forcing the output type into RHF's input slot — the naive
 * pattern — collapses both into the same type slot and causes `zodResolver` to
 * miscompile silently: `formState.errors` stays empty and the form swallows
 * Save with no user-visible feedback. Under `@hookform/resolvers` v3 + Zod v4
 * this was confirmed as a production regression (silent-submit bug class).
 * `useZodForm` keeps the generics separate end-to-end.
 *
 * Direct imports of `zodResolver` outside this module are blocked by the
 * `local/no-zod-resolver-without-use-zod-form` ESLint rule.
 *
 * DOM-free: this module only imports `react-hook-form` and `zod` — no DOM
 * APIs. It is safe to use in React Native / Expo (where `register` refs are
 * replaced by `Controller`, but `handleSubmit`, `formState`, and `reset` work
 * identically).
 *
 * App-global Zod error map: if you add a project-wide custom error map (via
 * `z.setErrorMap(...)`) it should be side-effect-imported HERE so every form
 * in the project picks it up automatically. At skeleton stage no global error
 * map exists yet — add the side-effect import at the top of this file when
 * one is introduced (e.g. `import "../your-error-map.js"`).
 *
 * The constraint `z.ZodType<unknown, FieldValues>` mirrors `zodResolver`'s own
 * Zod v4 overload: the schema's input must already be a record of fields, which
 * is true of every standard form schema.
 */
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type FieldValues, type UseFormProps, type UseFormReturn } from "react-hook-form";
import type { z } from "zod";

export type ZodFormSchema = z.ZodType<unknown, FieldValues>;

export type ZodFormReturn<TSchema extends ZodFormSchema> = UseFormReturn<
  z.input<TSchema>,
  unknown,
  z.output<TSchema>
>;

/**
 * Drop-in replacement for `useForm` that wires a Zod schema with correct
 * input/output generics and no zodResolver boilerplate at call sites.
 *
 * @example
 * ```ts
 * const { register, handleSubmit, formState } = useZodForm(loginSchema, {
 *   defaultValues: { email: "", password: "" },
 * });
 * ```
 *
 * `handleSubmit` will receive `z.output<typeof loginSchema>` (post-coerce
 * values); `register` and `defaultValues` accept `z.input<typeof loginSchema>`
 * (raw string / undefined values from the DOM).
 */
export function useZodForm<TSchema extends ZodFormSchema>(
  schema: TSchema,
  options?: Omit<UseFormProps<z.input<TSchema>, unknown, z.output<TSchema>>, "resolver">,
): ZodFormReturn<TSchema> {
  return useForm<z.input<TSchema>, unknown, z.output<TSchema>>({
    ...options,
    resolver: zodResolver(schema),
  });
}
