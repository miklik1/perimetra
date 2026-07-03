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

describe("WebhookDispatcher SSRF guard on the wire (allowPrivateNetwork opt-out)", () => {
  const dispatcher = new WebhookDispatcher();

  it("delivers to a loopback target when private egress is explicitly allowed", async () => {
    const before = hits;
    const delivery = await dispatcher.deliver(`http://127.0.0.1:${port}/hook`, EVENT, SECRET, {
      allowPrivateNetwork: true,
    });
    expect(delivery.status).toBe(200);
    expect(hits).toBe(before + 1);
  });

  it("follows a manual redirect, re-POSTing the identical signed body to the next hop", async () => {
    let targetMethod = "";
    let targetBody = "";
    const target = createServer((req, res) => {
      targetMethod = req.method ?? "";
      void readBody(req).then((data) => {
        targetBody = data;
        res.writeHead(200);
        res.end("ok");
      });
    });
    const targetPort = await listen(target);

    let redirectorBody = "";
    const redirector = createServer((req, res) => {
      void readBody(req).then((data) => {
        redirectorBody = data;
        res.writeHead(302, { Location: `http://127.0.0.1:${targetPort}/moved` });
        res.end();
      });
    });
    const redirPort = await listen(redirector);

    try {
      const delivery = await dispatcher.deliver(
        `http://127.0.0.1:${redirPort}/hook`,
        EVENT,
        SECRET,
        { allowPrivateNetwork: true },
      );
      expect(delivery.status).toBe(200);
      // Webhooks are not browsers: no GET downgrade, same signed bytes.
      expect(targetMethod).toBe("POST");
      expect(targetBody).toBe(redirectorBody);
      expect(JSON.parse(targetBody)).toMatchObject({ id: EVENT.id, type: EVENT.type });
    } finally {
      redirector.close();
      target.close();
    }
  });
});
