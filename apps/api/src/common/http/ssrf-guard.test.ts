import type { LookupAddress } from "node:dns";
import { describe, expect, it, vi } from "vitest";

import {
  assertEgressUrlAllowed,
  blockedReasonForIp,
  buildGuardedLookup,
  SsrfBlockedError,
  type AllAddressResolver,
} from "./ssrf-guard.js";

describe("blockedReasonForIp", () => {
  it("blocks every non-public IPv4 special-use range", () => {
    expect(blockedReasonForIp("127.0.0.1")).toBe("loopback");
    expect(blockedReasonForIp("169.254.169.254")).toBe("linkLocal"); // cloud metadata
    expect(blockedReasonForIp("10.0.0.5")).toBe("private");
    expect(blockedReasonForIp("172.16.0.1")).toBe("private");
    expect(blockedReasonForIp("192.168.1.1")).toBe("private");
    expect(blockedReasonForIp("100.64.0.1")).toBe("carrierGradeNat");
    expect(blockedReasonForIp("0.0.0.0")).toBe("unspecified");
    expect(blockedReasonForIp("240.0.0.1")).toBe("reserved");
    expect(blockedReasonForIp("255.255.255.255")).toBe("broadcast");
  });

  it("blocks every non-public IPv6 special-use range", () => {
    expect(blockedReasonForIp("::1")).toBe("loopback");
    expect(blockedReasonForIp("::")).toBe("unspecified");
    expect(blockedReasonForIp("fc00::1")).toBe("uniqueLocal");
    expect(blockedReasonForIp("fe80::1")).toBe("linkLocal");
    expect(blockedReasonForIp("fd00:ec2::254")).toBe("uniqueLocal"); // AWS IMDSv6
  });

  it("blocks v6 transition ranges that embed/tunnel v4 (6to4, Teredo, NAT64)", () => {
    // A blocklist that only knows ::ffff: misses ALL of these; the allowlist
    // (range() !== "unicast") refuses them without naming them.
    expect(blockedReasonForIp("2002:7f00:1::1")).toBe("6to4"); // embeds 127.0.0.1
    expect(blockedReasonForIp("2001::1")).toBe("teredo");
    expect(blockedReasonForIp("64:ff9b::a00:1")).toBe("rfc6052"); // NAT64 → 10.0.0.1
  });

  it("recurses IPv4-mapped IPv6 into the embedded v4 (cannot smuggle a private v4)", () => {
    expect(blockedReasonForIp("::ffff:127.0.0.1")).toBe("loopback");
    expect(blockedReasonForIp("::ffff:10.0.0.1")).toBe("private");
    expect(blockedReasonForIp("::ffff:169.254.169.254")).toBe("linkLocal");
  });

  it("recurses IPv4-COMPATIBLE IPv6 (::a.b.c.d, ::/96) — the deprecated sibling of mapped", () => {
    // The dotted form `::127.0.0.1` classifies as `ipv4Mapped` (caught by the
    // mapped branch); its HEX serialisation `::7f00:1` — the SAME address —
    // classifies as `unicast`, so only the `::/96` recursion refuses it. Since
    // the WHATWG URL parser normalises `[::127.0.0.1]` → `[::7f00:1]`, the hex
    // form is exactly what arrives at the guard, so it is the load-bearing one.
    expect(blockedReasonForIp("::127.0.0.1")).toBe("loopback");
    expect(blockedReasonForIp("::7f00:1")).toBe("loopback");
    expect(blockedReasonForIp("::169.254.169.254")).toBe("linkLocal"); // metadata (dotted)
    expect(blockedReasonForIp("::a9fe:a9fe")).toBe("linkLocal"); // metadata (hex ::/96 form)
    expect(blockedReasonForIp("::10.0.0.1")).toBe("private");
    expect(blockedReasonForIp("::255")).toBe("unspecified"); // ::0.0.0.255 (0.0.0.0/8)
    // :: and ::1 keep their own (correct) classification, not the embedded-v4 one.
    expect(blockedReasonForIp("::")).toBe("unspecified");
    expect(blockedReasonForIp("::1")).toBe("loopback");
  });

  it("allows ordinary global unicast (both families)", () => {
    expect(blockedReasonForIp("8.8.8.8")).toBeNull();
    expect(blockedReasonForIp("1.1.1.1")).toBeNull();
    expect(blockedReasonForIp("93.184.216.34")).toBeNull();
    expect(blockedReasonForIp("2606:4700:4700::1111")).toBeNull();
  });

  it("fails closed on an unparseable address", () => {
    expect(blockedReasonForIp("not-an-ip")).toBe("unparseable-address");
  });
});

describe("assertEgressUrlAllowed", () => {
  it("rejects non-http(s) schemes", () => {
    for (const url of [
      "file:///etc/passwd",
      "ftp://host/x",
      "gopher://host",
      "data:text/plain,x",
    ]) {
      expect(() => assertEgressUrlAllowed(url)).toThrow(SsrfBlockedError);
      expect(() => assertEgressUrlAllowed(url)).toThrowError(/scheme/);
    }
  });

  it("rejects an unparseable URL", () => {
    expect(() => assertEgressUrlAllowed("not a url")).toThrow(SsrfBlockedError);
  });

  it("rejects IP-literal hosts pointing at non-public addresses", () => {
    expect(() => assertEgressUrlAllowed("http://127.0.0.1/hook")).toThrow(SsrfBlockedError);
    expect(() => assertEgressUrlAllowed("https://169.254.169.254/")).toThrow(SsrfBlockedError);
    expect(() => assertEgressUrlAllowed("http://[::1]/")).toThrow(SsrfBlockedError);
    expect(() => assertEgressUrlAllowed("http://10.0.0.1/")).toThrow(SsrfBlockedError);
  });

  it("neutralises encoded-IP bypasses (URL parser canonicalises before classification)", () => {
    expect(() => assertEgressUrlAllowed("http://2130706433/")).toThrow(SsrfBlockedError); // decimal 127.0.0.1
    expect(() => assertEgressUrlAllowed("http://0x7f.0.0.1/")).toThrow(SsrfBlockedError); // hex
    expect(() => assertEgressUrlAllowed("http://[::ffff:127.0.0.1]/")).toThrow(SsrfBlockedError);
    // IPv4-compatible IPv6: the URL parser serialises [::127.0.0.1] → [::7f00:1].
    expect(() => assertEgressUrlAllowed("http://[::127.0.0.1]/")).toThrow(SsrfBlockedError);
    expect(() => assertEgressUrlAllowed("http://[::169.254.169.254]/")).toThrow(SsrfBlockedError);
  });

  it("allows public IP literals and hostnames (hostnames are NOT resolved here)", () => {
    expect(() => assertEgressUrlAllowed("https://93.184.216.34/hook")).not.toThrow();
    expect(() => assertEgressUrlAllowed("https://receiver.example.com/hook")).not.toThrow();
    expect(assertEgressUrlAllowed("https://receiver.example.com/hook")).toBeInstanceOf(URL);
  });

  it("allowPrivateTargets bypasses the IP gate but NOT the scheme gate", () => {
    expect(() =>
      assertEgressUrlAllowed("http://127.0.0.1/", { allowPrivateTargets: true }),
    ).not.toThrow();
    expect(() =>
      assertEgressUrlAllowed("file:///etc/passwd", { allowPrivateTargets: true }),
    ).toThrow(SsrfBlockedError);
  });
});

describe("buildGuardedLookup", () => {
  const addr = (address: string, family: 4 | 6 = 4): LookupAddress => ({ address, family });
  const resolverOf = (addresses: LookupAddress[]): AllAddressResolver =>
    vi.fn((_host, _opts, cb) => cb(null, addresses));

  it("returns the validated address when DNS resolves to public unicast", async () => {
    const lookup = buildGuardedLookup(resolverOf([addr("93.184.216.34")]));
    const result = await new Promise((resolve, reject) =>
      lookup("receiver.example.com", {}, (err, address, family) =>
        err ? reject(err) : resolve({ address, family }),
      ),
    );
    expect(result).toEqual({ address: "93.184.216.34", family: 4 });
  });

  it("blocks when DNS resolves to a private address (rebinding defence)", async () => {
    const lookup = buildGuardedLookup(resolverOf([addr("127.0.0.1")]));
    const err = await new Promise<Error | null>((resolve) =>
      lookup("evil.example.com", {}, (e) => resolve(e)),
    );
    expect(err).toBeInstanceOf(SsrfBlockedError);
    expect((err as SsrfBlockedError).reason).toBe("loopback");
  });

  it("blocks a name resolving to a MIX of public + private (treated as hostile)", async () => {
    const lookup = buildGuardedLookup(resolverOf([addr("93.184.216.34"), addr("10.0.0.5")]));
    const err = await new Promise<Error | null>((resolve) =>
      lookup("mixed.example.com", {}, (e) => resolve(e)),
    );
    expect(err).toBeInstanceOf(SsrfBlockedError);
    expect((err as SsrfBlockedError).reason).toBe("private");
  });

  it("blocks an empty resolution and propagates resolver errors", async () => {
    const empty = buildGuardedLookup(resolverOf([]));
    const emptyErr = await new Promise<Error | null>((resolve) =>
      empty("nx.example.com", {}, (e) => resolve(e)),
    );
    expect(emptyErr).toBeInstanceOf(SsrfBlockedError);
    expect((emptyErr as SsrfBlockedError).reason).toBe("no-address");

    const boom = new Error("ENOTFOUND") as NodeJS.ErrnoException;
    const failing = buildGuardedLookup(((_h, _o, cb) => cb(boom, [])) as AllAddressResolver);
    const failErr = await new Promise<Error | null>((resolve) =>
      failing("nx.example.com", {}, (e) => resolve(e)),
    );
    expect(failErr).toBe(boom);
  });

  it("honours undici's array shape when it requests all addresses", async () => {
    const lookup = buildGuardedLookup(resolverOf([addr("93.184.216.34"), addr("1.1.1.1")]));
    const result = await new Promise((resolve, reject) =>
      lookup("receiver.example.com", { all: true }, (err, address) =>
        err ? reject(err) : resolve(address),
      ),
    );
    expect(result).toEqual([
      { address: "93.184.216.34", family: 4 },
      { address: "1.1.1.1", family: 4 },
    ]);
  });

  it("always resolves the FULL set even when undici asks for one (so a mix is caught)", async () => {
    const resolver = resolverOf([addr("10.0.0.5")]);
    const lookup = buildGuardedLookup(resolver);
    await new Promise((resolve) => lookup("h.example.com", { all: false }, () => resolve(null)));
    expect(resolver).toHaveBeenCalledWith(
      "h.example.com",
      expect.objectContaining({ all: true }),
      expect.any(Function),
    );
  });
});
