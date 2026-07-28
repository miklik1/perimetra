/**
 * THE ROUTE-SEGMENT CREDENTIAL MANIFEST (ADR 0133) — deny-by-default.
 *
 * WHY THIS EXISTS. Every telemetry URL rule this repo has ever shipped reduces a
 * URL by KEEPING its pathname: the current primitive (`safeUrlOrRedact`,
 * skeleton ADR 1030) rebuilds `protocol + "//" + host + pathname`, and the
 * `dropUrlQuery` it replaced cut at `[?#]`. That is a deliberate, correct trade —
 * a path is what makes a Sentry event or a `$pageview` diagnostically useful.
 * But it rests on one silent assumption: **the path carries no secret.** The
 * moment a route puts a capability into a path segment, every URL-reducing rule
 * becomes a credential exporter, and no test in the scrubber's own suite can
 * notice, because the scrubber is behaving exactly as designed. That is not a
 * hypothetical: it happened here, to `/nabidka/[token]`, and it is why ADR 0130
 * moved that token to the URL fragment.
 *
 * So a repo that adopts a path-preserving scrubber owes an audit of its OWN path
 * segments, and the audit belongs next to the route contract rather than inside
 * the telemetry package. This file is that audit, made mechanical.
 *
 * WHY NOT A CREDENTIAL VOCABULARY. The obvious guard is an allow-list of
 * suspicious segment names — `token|secret|key|invite|reset` — that reddens when
 * one appears. It was considered and REJECTED, because it does not even catch
 * the case still live in this tree: `accept-invitation/[invitationId]` carries an
 * emailed unguessable id, and `invitationId` does not contain `invite`. A
 * vocabulary is a guess about what the next credential will be CALLED, and a
 * route that opts out of the guarantee by being named unimaginatively is exactly
 * the failure the guard is supposed to prevent.
 *
 * Deny-by-default inverts it. EVERY dynamic segment under `app/` must appear
 * below with an explicit judgement. A new route with a new segment fails the
 * suite until somebody writes down what its value is — so the default for an
 * unconsidered route is CLOSED, and the judgement is made once, in review, by
 * the person who knows.
 *
 * WHAT THIS GUARD DOES AND DOES NOT DO. It is a build-time completeness check.
 * It redacts nothing at runtime, and it must not be mistaken for having closed a
 * leak: it guarantees only that a credential-bearing route cannot be added
 * SILENTLY. Closing a leak, once one is declared here, is a separate act — for
 * `/nabidka` that act was ADR 0130.
 */

/** How a dynamic segment's value is protected. */
export type SegmentKind = "dynamic" | "catch-all" | "optional-catch-all";

export interface RouteSegmentDeclaration {
  /** Repo-relative directory. Keyed by DIRECTORY, not by URL and not by page
   *  file: `app/orders/[id]` has no `page.tsx` of its own (only children), so a
   *  walker keyed on page files would silently miss it. */
  dir: string;
  /** The segment name with any `...` stripped. */
  segment: string;
  kind: SegmentKind;
  /**
   * TRUE when possession of the URL is itself the authorisation — i.e. the value
   * of this segment is a bearer credential. A `true` here is a standing claim
   * that the route's URL must never reach a telemetry sink, a proxy access log
   * or a browser history entry, and it is the flag a future runtime redaction
   * would compile from.
   */
  credential: boolean;
  /**
   * What stops an anonymous stranger from reading this route. `proxy` = the
   * middleware session gate in `proxy.ts`; `api` = a server-side guard on the
   * data the route fetches (the proxy lets the request through, so the reason
   * must NAME the guard); `token` = nothing but the credential itself.
   */
  gatedBy: "proxy" | "api" | "token";
  /** One line: why this classification is true. Read by the next person. */
  reason: string;
}

/**
 * The declarations. Ordered by directory. Every entry is a judgement someone
 * made deliberately — if you are adding a row, the question to answer is:
 * *would an attacker who learned only this URL gain access to anything?*
 */
export const ROUTE_SEGMENTS: readonly RouteSegmentDeclaration[] = [
  {
    dir: "apps/web/app/accept-invitation/[invitationId]",
    segment: "invitationId",
    kind: "dynamic",
    credential: true,
    gatedBy: "token",
    reason:
      "The invitation id arrives only in an emailed link and is unguessable. Accepting also requires a signed-in invitee, so it is necessary-but-not-sufficient rather than a full bearer token — but it is still a secret in a URL and must never be logged. This is the row a credential-name vocabulary would have missed: 'invitationId' does not match 'invite'.",
  },
  {
    dir: "apps/web/app/api/[...path]",
    segment: "path",
    kind: "catch-all",
    credential: true,
    gatedBy: "api",
    reason:
      "Structurally a transport (the BFF forwards every browser call to the api), but the VALUE is an arbitrary api path, so it cannot be declared credential-free by construction — whatever a future endpoint puts in its URL lands here. Declared credential-bearing so the classification stays honest; note that a runtime redaction compiled from this file must NOT blank every /api/* segment, or it destroys route debuggability. That trade is ADR 0133's open follow-up, not a decision this file makes.",
  },
  {
    dir: "apps/web/app/customers/[id]",
    segment: "id",
    kind: "dynamic",
    credential: false,
    gatedBy: "proxy",
    reason:
      "An opaque UUIDv7 row id. '/customers' is in PROTECTED_PREFIXES and the api customers module is org-scoped, so the id alone authorises nothing.",
  },
  {
    dir: "apps/web/app/invoices/[id]",
    segment: "id",
    kind: "dynamic",
    credential: false,
    gatedBy: "proxy",
    reason:
      "An opaque row id. '/invoices' is in PROTECTED_PREFIXES; the faktura print child adds no segment of its own.",
  },
  {
    dir: "apps/web/app/orders/[id]",
    segment: "id",
    kind: "dynamic",
    credential: false,
    gatedBy: "proxy",
    reason:
      "An opaque row id. '/orders' is in PROTECTED_PREFIXES. This directory has NO page.tsx of its own — only production/ children — which is why the walker enumerates directories.",
  },
  {
    dir: "apps/web/app/platform/releases/drafts/[id]",
    segment: "id",
    kind: "dynamic",
    credential: false,
    gatedBy: "api",
    reason:
      "An opaque draft row id. '/platform' is deliberately NOT in PROTECTED_PREFIXES and this subtree has no layout gate: the guard is server-side, in the api — the org-scoped, vendor-only draft store behind PlatformGuard, with a missing or foreign id resolving to notFound().",
  },
  {
    dir: "apps/web/app/quotes/[id]",
    segment: "id",
    kind: "dynamic",
    credential: false,
    gatedBy: "proxy",
    reason:
      "An opaque row id. '/quotes' is in PROTECTED_PREFIXES; the nabidka/ and production/ children add no segments. NOTE the contrast with the buyer surface: the rep-facing quote is id-addressed and session-gated, while the buyer's copy is token-addressed — and that token now rides the URL fragment (ADR 0130), which is why no '/nabidka' row appears in this manifest at all.",
  },
  {
    dir: "apps/web/app/site/[projectId]",
    segment: "projectId",
    kind: "dynamic",
    credential: false,
    gatedBy: "proxy",
    reason: "An opaque project row id. '/site' is in PROTECTED_PREFIXES.",
  },
];
