import { SetMetadata, type CustomDecorator } from "@nestjs/common";

/** Metadata key the global SessionGuard checks (handler first, then class). */
// Namespaced so no third-party/future `SetMetadata("isPublic", …)` can
// accidentally open a route past the guard.
export const IS_PUBLIC_KEY = "auth:isPublic";

/**
 * Opt-out of the global SessionGuard (ADR 0099 — default-deny). Every Nest
 * route is authenticated unless it carries this decorator; use it only for
 * routes that are deliberately anonymous (health probes, inbound webhook
 * receivers that verify their own signature) and say why in a comment.
 */
export const Public = (): CustomDecorator => SetMetadata(IS_PUBLIC_KEY, true);
