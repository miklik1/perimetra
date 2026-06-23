import type cs from "./messages/cs";

/**
 * The message catalog shape. `cs` is the type source-of-truth so the
 * primary-language author is never blocked (ADR 0020); `en` is typed against
 * {@link MessagesInput} and the catalog-parity test guards runtime drift.
 *
 * `cs` is authored with `as const`, so `Messages` carries each message's LITERAL
 * string (e.g. `"Welcome back, {name}!"`). next-intl/use-intl derive ICU
 * argument shapes from those literals, so the precise type is what gives
 * `t("account.greeting", { name })` its argument safety — closing the catalog
 * with `satisfies Record<string, unknown>` instead would widen these to
 * `unknown` and silently disable that safety.
 *
 * The engine `AppConfig` augmentation that makes `t("…")` keys type-safe lives
 * in each PLATFORM binding — `web.tsx` augments `next-intl`, `native.tsx`
 * augments `use-intl` — because an app only has its own engine installed (a
 * neutral `declare module "next-intl"` would fail `tsc` in the mobile app, which
 * has only `use-intl`). This file stays neutral so the barrel imports no engine.
 */
export type Messages = typeof cs;

/**
 * `Messages` with leaf strings widened back to `string`, keeping the exact key
 * structure. Other locales (`en`) are authored against THIS so they keep
 * key-parity with `cs` (a missing/extra key fails `tsc`) while remaining free to
 * hold their own translated strings — `Messages` itself is pinned to the `cs`
 * literals for ICU inference and cannot type a second language's values.
 */
export type MessagesInput = WidenLeaves<Messages>;

/** Recursively widen every leaf `string` to `string`, preserving key structure. */
type WidenLeaves<T> = {
  [K in keyof T]: T[K] extends string ? string : WidenLeaves<T[K]>;
};
