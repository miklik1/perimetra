import { createServer, type IncomingMessage, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { WebhookDeliveryError, WebhookDispatcher } from "./webhook-dispatcher.service.js";

/**
 * End-to-end SSRF guard test over the REAL fetch transport (no mock) against
 * loopback servers — proves BOTH layers actually fire on the wire: the
 * literal-IP pre-flight and the DNS-rebinding-safe connector lookup that the
 * guarded dispatcher attaches (defect the mocked suite cannot see: with fetch
 * mocked, no DNS ever runs).
 */
const EVENT = { id: "0190a8c0-0000-7000-8000-0000000000ff", type: "test.event", payload: {} };
const SECRET = "whsec_test_secret";

function listen(server: Server): Promise<number> {
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)),
  );
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk: Buffer) => (data += chunk.toString()));
    req.on("end", () => resolve(data));
  });
}

let server: Server;
let port: number;
let hits = 0;

beforeAll(async () => {
  server = createServer((_req, res) => {
    hits += 1;
    res.writeHead(200);
    res.end("ok");
  });
  port = await listen(server);
});

afterAll(() => {
  server.close();
});

describe("WebhookDispatcher SSRF guard on the wire (secure default)", () => {
  const dispatcher = new WebhookDispatcher();

  it("blocks a loopback IP-literal target at the pre-flight, never opening a socket", async () => {
    const before = hits;
    const error = await dispatcher
      .deliver(`http://127.0.0.1:${port}/hook`, EVENT, SECRET)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WebhookDeliveryError);
    expect((error as WebhookDeliveryError).status).toBeNull();
    expect((error as WebhookDeliveryError).message).toMatch(/blocked/);
    expect(hits).toBe(before); // server was never reached
  });

  it("blocks a HOSTNAME that resolves to loopback at the connector (rebinding defence)", async () => {
    // `localhost` passes the sync pre-flight (not an IP literal); only the
    // guarded dispatcher's lookup can catch what it RESOLVES to — this is the
    // TOCTOU-closing layer working over a real socket attempt.
    const before = hits;
    const error = await dispatcher
      .deliver(`http://localhost:${port}/hook`, EVENT, SECRET)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WebhookDeliveryError);
    expect((error as WebhookDeliveryError).status).toBeNull();
    expect((error as WebhookDeliveryError).message).toMatch(/blocked.*loopback/);
    expect(hits).toBe(before);
  });

  it("blocks the cloud-metadata address", async () => {
    const error = await dispatcher
      .deliver("http://169.254.169.254/latest/meta-data/", EVENT, SECRET)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WebhookDeliveryError);
  });

  it("blocks an IPv4-COMPATIBLE IPv6 literal (::a.b.c.d) — embedded-v4 smuggling", async () => {
    // [::127.0.0.1] / [::169.254.169.254] serialise to ::7f00:1 / ::a9fe:a9fe,
    // which a ::ffff:-only blocklist waves through as plain global v6.
    for (const url of ["http://[::127.0.0.1]/hook", "http://[::169.254.169.254]/"]) {
      const error = await dispatcher.deliver(url, EVENT, SECRET).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(WebhookDeliveryError);
    }
  });

  it("blocks a non-http(s) scheme", async () => {
    const error = await dispatcher
      .deliver("file:///etc/passwd", EVENT, SECRET)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WebhookDeliveryError);
  });
});

describe("WebhookDispatcher SSRF guard on the wire (deployment-wide private hatch)", () => {
  // The hatch is DEPLOYMENT-wide and constructor-injected (ADR 1047) — there is
  // no per-delivery or per-endpoint way to reach it.
  const dispatcher = new WebhookDispatcher({ allowPrivateTargets: true });

  it("delivers to a loopback target when private egress is allowed deployment-wide", async () => {
    const before = hits;
    const delivery = await dispatcher.deliver(`http://127.0.0.1:${port}/hook`, EVENT, SECRET);
    expect(delivery.status).toBe(200);
    expect(hits).toBe(before + 1);
  });

  it("keeps the guarded dispatcher attached under the hatch (it is relaxed, not removed)", async () => {
    // A hostname target under the hatch still goes through the validating
    // connector: `localhost` resolves to loopback, which the PERMISSIVE
    // connector now allows — so a 200 here is positive evidence the connector
    // ran and was configured, not that it was dropped. (The secure-default
    // suite above proves the same name is REFUSED without the hatch, so the
    // two together pin both directions.)
    const before = hits;
    const delivery = await dispatcher.deliver(`http://localhost:${port}/hook`, EVENT, SECRET);
    expect(delivery.status).toBe(200);
    expect(hits).toBe(before + 1);
  });

  it("refuses cloud-metadata BY NAME under the hatch, without resolving it", async () => {
    for (const url of [
      "http://metadata.google.internal/computeMetadata/v1/",
      "http://metadata.goog/computeMetadata/v1/",
      "http://metadata/computeMetadata/v1/",
    ]) {
      const error = await dispatcher.deliver(url, EVENT, SECRET).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(WebhookDeliveryError);
      expect((error as WebhookDeliveryError).message).toMatch(/cloud-metadata hostname/);
    }
  });

  it("refuses the metadata ADDRESS under the hatch (linkLocal is not 'private')", async () => {
    const error = await dispatcher
      .deliver("http://169.254.169.254/latest/meta-data/", EVENT, SECRET)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WebhookDeliveryError);
    expect((error as WebhookDeliveryError).message).toMatch(/linkLocal/);
  });

  it("follows a SAME-ORIGIN redirect, re-POSTing the identical signed body", async () => {
    let movedMethod = "";
    let movedBody = "";
    let hookBody = "";
    const receiver = createServer((req, res) => {
      if (req.url === "/moved") {
        movedMethod = req.method ?? "";
        void readBody(req).then((data) => {
          movedBody = data;
          res.writeHead(200);
          res.end("ok");
        });
        return;
      }
      void readBody(req).then((data) => {
        hookBody = data;
        // Same origin, different path — the legitimate "endpoint moved" shape.
        res.writeHead(302, { Location: "/moved" });
        res.end();
      });
    });
    const receiverPort = await listen(receiver);

    try {
      const delivery = await dispatcher.deliver(
        `http://127.0.0.1:${receiverPort}/hook`,
        EVENT,
        SECRET,
      );
      expect(delivery.status).toBe(200);
      // Webhooks are not browsers: no GET downgrade, same signed bytes.
      expect(movedMethod).toBe("POST");
      expect(movedBody).toBe(hookBody);
      expect(JSON.parse(movedBody)).toMatchObject({ id: EVENT.id, type: EVENT.type });
    } finally {
      receiver.close();
    }
  });

  it("HONEYPOT: a redirect to another origin reaches it ZERO times", async () => {
    // The test the vault finding prescribes, on real sockets. The honeypot is a
    // second loopback server the receiver names in its `Location`; under the
    // hatch its address is perfectly reachable, so nothing but the redirect
    // posture stands between the signed body and it. Delete the cross-origin
    // refusal and this server gets hit — which is how it was disarm-verified.
    let honeypotHits = 0;
    const honeypot = createServer((_req, res) => {
      honeypotHits += 1;
      res.writeHead(200);
      res.end("pwned");
    });
    const honeypotPort = await listen(honeypot);

    const redirector = createServer((_req, res) => {
      res.writeHead(302, { Location: `http://127.0.0.1:${honeypotPort}/steal` });
      res.end();
    });
    const redirPort = await listen(redirector);

    try {
      const error = await dispatcher
        .deliver(`http://127.0.0.1:${redirPort}/hook`, EVENT, SECRET)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(WebhookDeliveryError);
      expect((error as WebhookDeliveryError).message).toMatch(/refused a cross-origin redirect/);
      expect(honeypotHits).toBe(0);
    } finally {
      redirector.close();
      honeypot.close();
    }
  });
});
