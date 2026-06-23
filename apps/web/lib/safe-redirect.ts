/**
 * Open-redirect guard for the `?next=` return-URL on the login flow (the proxy
 * captures where an unauthenticated visitor was headed; the login form sends
 * them back there after sign-in). Same pattern as Perimetra ADR 0058: a safe
 * target is a BARE, same-origin path — anything that could resolve to another
 * origin (absolute URL, protocol-relative `//evil`, backslash `/\evil`, a
 * scheme like `javascript:`) is rejected, and the value is re-serialized so a
 * host or scheme can never be echoed back into the redirect.
 *
 * The return value is a same-origin path for `router.push()` (or a same-origin
 * redirect util) ONLY — never concatenate it into a raw `Location` header,
 * where a server's `%2F`-normalisation could reinterpret it.
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) {
    return null;
  }
  // Reject embedded C0 control chars (tab / CR / LF, code points < 0x20): the
  // WHATWG URL parser STRIPS them before parsing, so `/<TAB>//evil.com` would
  // slip past the prefix guards and re-form as `//evil.com`. The origin check
  // below still catches it, but rejecting here keeps the output a faithful echo
  // of the input.
  for (let i = 0; i < raw.length; i += 1) {
    if (raw.charCodeAt(i) < 0x20) return null;
  }
  try {
    // Resolve against an opaque base: a genuine internal path keeps THIS origin;
    // a smuggled host/scheme resolves elsewhere → origin mismatch → reject.
    const base = "http://localhost";
    const url = new URL(raw, base);
    if (url.origin !== base) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}
