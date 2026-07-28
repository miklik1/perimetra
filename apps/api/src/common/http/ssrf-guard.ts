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
 *
 * THE HATCH IS A RELAXATION, NEVER A BYPASS (ADR 1047, ports anyora ADR 0079).
 * `allowPrivateTargets` relaxes the public-unicast allowlist and NOTHING else.
 * Four checks sit AHEAD of it and are unreachable by it, in BOTH layers:
 * the scheme gate, the cloud-metadata HOSTNAME pre-block
 * ({@link BLOCKED_METADATA_HOSTNAMES}), {@link UNCONDITIONAL_BLOCKS}, and the
 * fail-closed unparseable-address rule. An exemption evaluated before a deny
 * list is not an exemption from it — it is a bypass of it, and where a hatch
 * is PLACED decides its scope regardless of what its documentation claims it
 * relaxes.
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
 * Cloud-metadata hostnames refused WITHOUT waiting for DNS, and refused even
 * under `allowPrivateTargets` — no deployment runs a webhook receiver on its
 * own instance-metadata service, so the hatch has no reason to reach one.
 *
 * All three GCE spellings: the FQDN, the short zone name, and the BARE LABEL
 * `metadata`, which resolves via search-domain completion on a GCE instance.
 * Compared against a hostname normalised by {@link normalizeHostname}.
 */
const BLOCKED_METADATA_HOSTNAMES: ReadonlySet<string> = new Set([
  "metadata.google.internal",
  "metadata.goog",
  "metadata",
]);

/**
 * Address ranges refused REGARDLESS of `allowPrivateTargets`, each with the
 * reason it reports. These are checked ahead of the hatch because the generic
 * classification the hatch honours (`linkLocal`, `uniqueLocal`,
 * `carrierGradeNat`) is exactly what would let an instance-metadata endpoint
 * — and with it the instance's IAM credentials — through on a permissive
 * deployment.
 *
 * - `169.254.0.0/16` / `fe80::/10` — IMDS answers at 169.254.169.254 on AWS,
 *   Azure, GCP, DigitalOcean, OpenStack and Oracle. The WHOLE link-local space
 *   is blocked rather than the single host: no real receiver is reachable
 *   there, so blocking wide costs nothing and leaves no next address to chase.
 * - `fd00:ec2::/32` — AWS's IPv6 IMDS, which sits INSIDE the unique-local space
 *   the hatch opens.
 * - `100.100.100.200/32` — Alibaba Cloud's IMDS, inside CGNAT for the same
 *   reason.
 */
const UNCONDITIONAL_BLOCKS: ReadonlyArray<{
  cidr: [ipaddr.IPv4 | ipaddr.IPv6, number];
  reason: string;
}> = [
  { cidr: ipaddr.parseCIDR("169.254.0.0/16"), reason: "linkLocal" },
  { cidr: ipaddr.parseCIDR("fe80::/10"), reason: "linkLocal" },
  { cidr: ipaddr.parseCIDR("fd00:ec2::/32"), reason: "cloud-metadata" },
  { cidr: ipaddr.parseCIDR("100.100.100.200/32"), reason: "cloud-metadata" },
];

/**
 * The comparable form of a URL host: IPv6 brackets stripped, the trailing dot
 * of an absolute DNS name removed, lowercased. WHATWG `URL` already lowercases
 * and canonicalises, but `metadata.google.internal.` keeps its trailing dot and
 * would otherwise miss {@link BLOCKED_METADATA_HOSTNAMES} while still resolving.
 */
function normalizeHostname(host: string): string {
  return host
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
    .toLowerCase();
}

/**
 * The embedded IPv4 of a v6 address that carries one — IPv4-MAPPED
 * (`::ffff:a.b.c.d`) or the deprecated IPv4-COMPATIBLE `::/96` block
 * (`::a.b.c.d`, e.g. `::127.0.0.1` → `::7f00:1`). The OS may route to the
 * embedded v4, so WITHOUT this the v4 hides behind a v6 spelling and fails OPEN
 * through both guard layers.
 *
 * Precisely (ipaddr.js 2.x, measured): the DOTTED form `::127.0.0.1` classifies
 * as `ipv4Mapped` and is caught by the first branch below; the HEX form
 * `::7f00:1` — the SAME address — classifies as `unicast`, and only the `::/96`
 * branch refuses it. Since the WHATWG URL parser normalises
 * `http://[::127.0.0.1]/` to `[::7f00:1]`, the hex form is the one that actually
 * arrives at the guard, which makes the `::/96` branch load-bearing rather than
 * merely defensive.
 *
 * Returns null for a plain global v6 and for `::` / `::1` (their own special-use
 * ranges classify those correctly).
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
 * Returns `null` when the address may be egressed to, otherwise a short reason
 * naming why it is blocked. Both IPv4-mapped and IPv4-compatible IPv6 are
 * recursed into their embedded v4 so the v6 spelling cannot smuggle a
 * private/loopback v4 past the allowlist (see `embeddedIPv4`).
 *
 * ORDER IS THE SECURITY PROPERTY (ADR 1047). Fail-closed parsing and
 * {@link UNCONDITIONAL_BLOCKS} are applied BEFORE `allowPrivateTargets` is even
 * read; the hatch then permits any remaining non-public address. One
 * classification path serves both guard layers, so they cannot drift apart.
 */
export function blockedReasonForIp(ip: string, options: SsrfGuardOptions = {}): string | null {
  let addr: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    addr = ipaddr.parse(ip);
  } catch {
    // An address DNS/URL handed us that we cannot parse is, by definition, not
    // a verified-public address — fail closed. The hatch permits PRIVATE
    // destinations, never unclassifiable ones.
    return "unparseable-address";
  }
  if (addr.kind() === "ipv6") {
    const embedded = embeddedIPv4(addr as ipaddr.IPv6);
    if (embedded) return blockedReasonForIp(embedded, options);
  }
  for (const { cidr, reason } of UNCONDITIONAL_BLOCKS) {
    // `match` throws across families (v4 address vs v6 CIDR) — skip those.
    if (addr.kind() === cidr[0].kind() && addr.match(cidr)) return reason;
  }
  // Only now may the hatch speak, and all it can say is "private is fine".
  if (options.allowPrivateTargets) return null;
  // ALLOWLIST: `unicast` is ipaddr.js's label for an ordinary global address
  // (both families). Everything else is a special-use range we refuse.
  const range = addr.range();
  return range === "unicast" ? null : range;
}

export interface SsrfGuardOptions {
  /**
   * Relax the public-unicast allowlist so ordinary private/loopback/unique-local
   * targets may be reached. Default `false` (secure). Set ONLY for local dev or
   * a deliberately-trusted internal deployment where webhook receivers live on a
   * private network — never on the public internet.
   *
   * It is a RELAXATION, not an off switch: the scheme gate,
   * {@link BLOCKED_METADATA_HOSTNAMES}, {@link UNCONDITIONAL_BLOCKS} and the
   * fail-closed unparseable rule all still apply, and the guarded dispatcher is
   * still attached (merely configured permissively) so a HOSTNAME's resolution
   * is still validated.
   */
  allowPrivateTargets?: boolean;
}

/**
 * Synchronous URL pre-flight. Validates scheme always, the cloud-metadata
 * hostname pre-block always, and IP-literal hosts eagerly (the layer undici's
 * lookup can't cover). Ordinary hostnames are intentionally NOT resolved here —
 * resolving would (a) break fetch-mocked unit tests and (b) reintroduce a
 * check-vs-connect TOCTOU; their DNS gate is the dispatcher. Returns the parsed
 * `URL`; throws `SsrfBlockedError` on refusal.
 *
 * `allowPrivateTargets` is consulted ONLY by `blockedReasonForIp`, at the
 * bottom — every check above it is unconditional (ADR 1047).
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

  // IPv6 literals arrive bracket-wrapped from the URL parser: [::1].
  const host = normalizeHostname(url.hostname);
  if (BLOCKED_METADATA_HOSTNAMES.has(host)) {
    throw new SsrfBlockedError(
      "cloud-metadata-hostname",
      `egress URL host ${url.hostname} is a cloud-metadata hostname`,
    );
  }
  if (isIP(host) !== 0) {
    const reason = blockedReasonForIp(host, options);
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
 * `hostname`, refuses if ANY is disallowed (a name resolving to a mix of public
 * + private is treated as hostile), and otherwise hands undici the validated
 * resolution — so the address that was checked is the address that is dialled.
 * The resolver is injectable for deterministic tests.
 *
 * `guardOptions` is deliberately NOT named `options`: the returned connector's
 * own second parameter is undici's `LookupOptions`, and naming both `options`
 * shadows the guard's — the threading then silently does nothing, and only a
 * test asserting the hatch STILL WORKS catches it (the refusal tests pass
 * either way, because they also pass when the option is ignored).
 */
export function buildGuardedLookup(
  resolve: AllAddressResolver = dnsLookup as AllAddressResolver,
  guardOptions: SsrfGuardOptions = {},
): LookupFunction {
  return function guardedLookup(hostname, options, callback): void {
    // The hostname pre-block is unconditional and applies here too: a name is
    // refused before it is ever resolved, hatch or no hatch.
    if (BLOCKED_METADATA_HOSTNAMES.has(normalizeHostname(hostname))) {
      return callback(
        new SsrfBlockedError("cloud-metadata-hostname", `${hostname} is a cloud-metadata hostname`),
        "",
        0,
      );
    }
    resolve(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, "", 0);
      const list = Array.isArray(addresses) ? addresses : [];
      if (list.length === 0) {
        return callback(new SsrfBlockedError("no-address", `no address for ${hostname}`), "", 0);
      }
      for (const entry of list) {
        const reason = blockedReasonForIp(entry.address, guardOptions);
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
 *
 * ALWAYS CONSTRUCT IT, EVEN UNDER THE HATCH (ADR 1047). `allowPrivateTargets`
 * configures the connector permissively; it must never be expressed by passing
 * `undefined` as the dispatcher instead. This is the ONLY layer that can see
 * where a HOSTNAME resolves, so dropping it does not relax the guard — it
 * deletes it, and a name an attacker registered pointing at 169.254.169.254
 * then needs no DNS control at all to reach the instance's IAM credentials.
 */
export function createSsrfGuardedDispatcher(
  opts: { lookup?: AllAddressResolver } & SsrfGuardOptions = {},
): Agent {
  return new Agent({
    connect: {
      lookup: buildGuardedLookup(opts.lookup, { allowPrivateTargets: opts.allowPrivateTargets }),
    },
  });
}
