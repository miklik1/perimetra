/**
 * Sanitise a `?next=` post-auth redirect target to a SAME-ORIGIN relative path
 * (the open-redirect guard, shared by every auth entry point — `/login`,
 * `/two-factor`). We resolve `next` against a dummy origin with the SAME WHATWG
 * URL parser the browser/Next router use, then reject anything that lands
 * off-origin — this catches absolute URLs, the protocol-relative `//evil.com` /
 * backslash `/\evil.com` tricks AND the control-char variants
 * (`/%09//evil.com` → tab-stripped to `//evil.com`) that a naive `startsWith`
 * prefix check lets through. ONE implementation so the security logic can't drift.
 */
export function safeNext(next: string | string[] | undefined): string {
  if (typeof next !== "string") return "/account";
  try {
    const url = new URL(next, "http://localhost");
    if (url.origin !== "http://localhost") return "/account";
    return url.pathname + url.search + url.hash;
  } catch {
    return "/account";
  }
}
