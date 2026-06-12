import type cs from "./messages/cs";

/**
 * The message catalog shape. `cs` is the type source-of-truth so the
 * primary-language author is never blocked (ADR 0020); `en` is typed against
 * this and the catalog-parity test guards runtime drift.
 *
 * The engine `AppConfig` augmentation that makes `t("…")` keys type-safe lives
 * in each PLATFORM binding — `web.tsx` augments `next-intl`, `native.tsx`
 * augments `use-intl` — because an app only has its own engine installed (a
 * neutral `declare module "next-intl"` would fail `tsc` in the mobile app, which
 * has only `use-intl`). This file stays neutral so the barrel imports no engine.
 */
export type Messages = typeof cs;
