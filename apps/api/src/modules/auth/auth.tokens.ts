/**
 * DI tokens in their own file so consumers (guard, future modules) don't
 * import `auth.module.ts` — that import cycle would evaluate the decorators
 * before the tokens exist.
 */
export const AUTH = Symbol("AUTH");
export const REDIS = Symbol("REDIS");
