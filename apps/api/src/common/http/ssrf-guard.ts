/**
 * SSRF egress guard for outbound HTTP to USER-controlled URLs (webhook
 * endpoints today; avatar/remote-content fetches in projects tomorrow). A
 * guard is only needed where the *destination* is attacker-influenced —
 * fixed-host egress (telemetry, an LLM provider, S3) does NOT route through
 * this.
 *
 * Two layers, BOTH required (a single layer is bypassable):
 *
 *  1. `assertEgressUrlAllowed` — a SYNCHRONOUS pre-flight on the URL itself:
 *     rejects non-http(s) schemes and, when the host is an IP LITERAL, rejects
 *     any non-public address. This is the ONLY layer that fires for literal-IP
 *     targets — undici skips `connect.lookup` entirely when no DNS resolution
 *     is needed (verified), so `http://127.0.0.1/` / `http://169.254.169.254/`
 *     would otherwise sail straight through the dispatcher.
 *
 *  2. `createSsrfGuardedDispatcher` — an undici `Agent` whose connector resolves
 *     DNS and validates EVERY returned address before any socket opens, then
 *     connects using that SAME validated resolution. This is the DNS-rebinding
 *     -safe layer: a hostname that passes the check cannot be re-pointed at an
 *     internal IP between check and connect, because there is no second lookup.
 *
 * Encoded-IP bypasses (`http://2130706433`, `http://0x7f.0.0.1`,
 * `http://[::ffff:127.0.0.1]`, `http://[::127.0.0.1]`) are neutralised: the
 * WHATWG URL parser canonicalises them, and BOTH IPv4-mapped and IPv4-compatible
 * (`::/96`) IPv6 are recursed into their embedded v4 (see `embeddedIPv4`).
 * Classification is ALLOWLIST: only ordinary global unicast may egress —
 * anything else (loopback, link-local incl. the cloud-metadata 169.254.169.254 /
 * fd00:ec2::254, RFC1918 private, CGNAT, unique-local, unspecified, reserved,
 * 6to4/teredo/NAT64, multicast) is blocked.
 */
import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from "node:dns";
import { isIP, type LookupFunction } from "node:net";
import ipaddr from "ipaddr.js";
import { Agent } from "undici";

/** Raised when a destination is refused by the egress guard. */
export class SsrfBlockedError extends Error {
  constructor(
    /** Short machine reason, e.g. `loopback`, `scheme`, `private`. */
    readonly reason: string,
    message: string,
  ) {
    super(message);
    this.name = "SsrfBlockedError";
  }
}

const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

/** The deprecated IPv4-COMPATIBLE block `::a.b.c.d` (RFC 4291 §2.5.5.1). */
const IPV4_COMPATIBLE_CIDR = ipaddr.parseCIDR("::/96");

/**
 * The embedded IPv4 of a v6 address that carries one — IPv4-MAPPED
 * (`::ffff:a.b.c.d`) or the deprecated IPv4-COMPATIBLE `::/96` block
 * (`::a.b.c.d`, e.g. `::127.0.0.1` → `::7f00:1`). The OS may route to the
 * embedded v4, and ipaddr.js classifies a bare `::a.b.c.d` as `unicast`, so
 * WITHOUT this the v4 hides behind a v6 spelling (`http://[::127.0.0.1]/`) and
 * fails OPEN through both guard layers. Returns null for a plain global v6 and
 * for `::` / `::1` (their own special-use ranges classify those correctly).
 */
function embeddedIPv4(v6: ipaddr.IPv6): string | null {
  if (v6.isIPv4MappedAddress()) return v6.toIPv4Address().toString();
  if (v6.match(IPV4_COMPATIBLE_CIDR)) {
    const v4 = ipaddr.fromByteArray(v6.toByteArray().slice(12)).toString();
    return v4 === "0.0.0.0" || v4 === "0.0.0.1" ? null : v4;
  }
  return null;
}

/**
 * Classify a single IP literal (the canonical string DNS/URL parsing yields).
 * Returns `null` when the address is globally-routable unicast (safe to egress
 * to), otherwise a short reason naming why it is blocked. Both IPv4-mapped and
 * IPv4-compatible IPv6 are recursed into their embedded v4 so the v6 spelling
 * cannot smuggle a private/loopback v4 past the allowlist (see `embeddedIPv4`).
 */
export function blockedReasonForIp(ip: string): string | null {
  let addr: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    addr = ipaddr.parse(ip);
  } catch {
    // An address DNS/URL handed us that we cannot parse is, by definition, not
    // a verified-public address — fail closed.
    return "unparseable-address";
  }
  if (addr.kind() === "ipv6") {
    const embedded = embeddedIPv4(addr as ipaddr.IPv6);
    if (embedded) return blockedReasonForIp(embedded);
  }
  // ALLOWLIST: `unicast` is ipaddr.js's label for an ordinary global address
  // (both families). Everything else is a special-use range we refuse.
  const range = addr.range();
  return range === "unicast" ? null : range;
}

export interface SsrfGuardOptions {
  /**
   * Permit private/loopback/link-local targets. Default `false` (secure).
   * Set ONLY for local dev or a deliberately-trusted internal deployment where
   * webhook receivers live on a private network — never on the public internet.
   */
  allowPrivateTargets?: boolean;
}

/**
 * Synchronous URL pre-flight. Validates scheme always, and IP-literal hosts
 * eagerly (the layer undici's lookup can't cover). Hostnames are intentionally
 * NOT resolved here — resolving would (a) break fetch-mocked unit tests and
 * (b) reintroduce a check-vs-connect TOCTOU; their DNS gate is the dispatcher.
 * Returns the parsed `URL`; throws `SsrfBlockedError` on refusal.
 */
export function assertEgressUrlAllowed(rawUrl: string, options: SsrfGuardOptions = {}): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError("invalid-url", `egress URL is not a valid absolute URL: ${rawUrl}`);
  }
  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    throw new SsrfBlockedError(
      "scheme",
      `egress URL scheme "${url.protocol}" is not allowed (http/https only)`,
    );
  }
  if (options.allowPrivateTargets) return url;

  // IPv6 literals arrive bracket-wrapped from the URL parser: [::1].
  const host = url.hostname.replace(/^\[/, "").replace(/\]$/, "");
  if (isIP(host) !== 0) {
    const reason = blockedReasonForIp(host);
    if (reason) {
      throw new SsrfBlockedError(
        reason,
        `egress URL host ${url.hostname} is a non-public address (${reason})`,
      );
    }
  }
  return url;
}

/**
 * Node's `dns.lookup` (all-addresses overload). undici's connector calls its
 * `lookup` with `all` unset/false, but the guard always resolves the full set
 * so it can refuse a name that points at a mix of public + private addresses.
 */
export type AllAddressResolver = (
  hostname: string,
  options: LookupOptions & { all: true },
  callback: (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void,
) => void;

/**
 * Build the validating connector `lookup`. It resolves ALL addresses for
 * `hostname`, refuses if ANY is non-public (a name resolving to a mix of public
 * + private is treated as hostile), and otherwise hands undici the validated
 * resolution — so the address that was checked is the address that is dialled.
 * The resolver is injectable for deterministic tests.
 */
export function buildGuardedLookup(
  resolve: AllAddressResolver = dnsLookup as AllAddressResolver,
): LookupFunction {
  return function guardedLookup(hostname, options, callback): void {
    resolve(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, "", 0);
      const list = Array.isArray(addresses) ? addresses : [];
      if (list.length === 0) {
        return callback(new SsrfBlockedError("no-address", `no address for ${hostname}`), "", 0);
      }
      for (const entry of list) {
        const reason = blockedReasonForIp(entry.address);
        if (reason) {
          return callback(
            new SsrfBlockedError(
              reason,
              `${hostname} resolves to a non-public address (${entry.address}, ${reason})`,
            ),
            "",
            0,
          );
        }
      }
      // Honour undici's requested shape: array when it asked for `all`, else the
      // first validated address (undici connects to exactly what we return).
      if (options.all) return callback(null, list);
      const first = list[0]!;
      return callback(null, first.address, first.family);
    });
  };
}

/**
 * undici dispatcher that gates every DNS-resolved connection through
 * {@link buildGuardedLookup}. Pass it as fetch's `dispatcher`; pair it with
 * the {@link assertEgressUrlAllowed} pre-flight (per redirect hop, when hops
 * are followed manually) for the complete guard. `lookup` is injectable for
 * tests.
 */
export function createSsrfGuardedDispatcher(opts: { lookup?: AllAddressResolver } = {}): Agent {
  return new Agent({ connect: { lookup: buildGuardedLookup(opts.lookup) } });
}
