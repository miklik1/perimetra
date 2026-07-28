/**
 * Document delivery (ADR 0129, Wave A2) at the HTTP layer against the real
 * containers, with a CAPTURING `EMAIL_SENDER` so the rendered mail is asserted
 * end to end rather than through a mock of the seam.
 *
 * What this file exists to prove:
 *  - a send queues a PII-FREE record: the raw response body carries neither the
 *    buyer's address nor `recipientEmail` / `linkPath` / `failureReason` /
 *    `payToIban`;
 *  - the committed OUTBOX ROW's payload has exactly one key, `deliveryId` — the
 *    IDs-only doctrine, read straight off the table (the `outbox.itest.ts`
 *    precedent);
 *  - the WORKER handler run TWICE against real pg sends exactly ONCE (the
 *    conditional-claim double-send guard) and produces the real Czech subject +
 *    the ADR-0089 landing link;
 *  - the ordered refusals: `send_in_progress`, `recipient_email_missing`,
 *    `customer_anonymized`;
 *  - the access boundary: workshop 403s the whole surface; another org's rep
 *    404s (never 403 — no existence oracle).
 */
import { type NestFastifyApplication } from "@nestjs/platform-fastify";
import { eq } from "drizzle-orm";
import { ClsService } from "nestjs-cls";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Db } from "@repo/db";
import { member } from "@repo/db/schema/auth";
import { outbox } from "@repo/db/schema/outbox";
import { siteFenceConfig, siteGateConfig, sitePrices, steppedSite } from "@repo/fixtures";

import { ENV } from "../src/common/config/env.js";
import { DB } from "../src/common/db/db.module.js";
import { DeliveriesEventsHandler } from "../src/modules/deliveries/deliveries.events.js";
import { DeliveriesRepository } from "../src/modules/deliveries/deliveries.repository.js";
import { DOCUMENT_DELIVERY_REQUESTED } from "../src/modules/deliveries/deliveries.tokens.js";
import { EmailService } from "../src/modules/email/email.service.js";
import { EMAIL_SENDER, type EmailMessage } from "../src/modules/email/email.tokens.js";
import {
  createApiApp,
  inject,
  seedGoldenCorpusFor,
  signUpUser,
  TEST_LEGAL_PROFILE,
  type TestUser,
} from "./setup/app.js";

const TEST_IBAN = "CZ6508000000192000145399";
const BUYER_EMAIL = "kupujici@example.cz";

const instances = [
  { instanceId: "gate", releaseId: "sliding-gate@1", input: siteGateConfig },
  { instanceId: "fenceA", releaseId: "fence-run@1", input: siteFenceConfig },
  { instanceId: "fenceB", releaseId: "fence-run@1", input: siteFenceConfig },
];

const priceTableBody = {
  currency: "CZK",
  effectiveFrom: "2026-01-01T00:00:00.000Z",
  dphRate: "21",
  table: sitePrices,
};

/**
 * react-email's `render` prepends the XHTML-transitional DOCTYPE, whose PUBLIC
 * identifier is itself a `http://www.w3.org/…` URL. Strip it so the ADR-0129
 * "this mail carries NO link" assertions test the MAIL, not react-email's
 * boilerplate (the same helper `email.service.test.ts` uses).
 */
function mailBody(html: string): string {
  return html.replace(/^<!DOCTYPE[^>]*>/, "");
}

interface DeliveryBody {
  id: string;
  documentType: string;
  documentId: string;
  documentNumber: string;
  customerId: string;
  status: string;
  sentAt: string | null;
  createdAt: string;
}

describe("document delivery (HTTP, real stack) — ADR 0129", () => {
  let app: NestFastifyApplication;
  let db: Db;
  let tenant: TestUser;
  /** Every message the capturing sender accepted, across the whole file. */
  const sent: EmailMessage[] = [];

  const post = (user: TestUser, url: string, payload?: Record<string, unknown>) =>
    inject(app, { method: "POST", url, headers: { cookie: user.cookie }, payload: payload ?? {} });
  const get = (user: TestUser, url: string) =>
    inject(app, { method: "GET", url, headers: { cookie: user.cookie } });
  const put = (user: TestUser, url: string, payload: Record<string, unknown>) =>
    inject(app, { method: "PUT", url, headers: { cookie: user.cookie }, payload });
  const del = (user: TestUser, url: string) =>
    inject(app, { method: "DELETE", url, headers: { cookie: user.cookie } });
  const setRole = (userId: string, role: string) =>
    db.update(member).set({ role }).where(eq(member.userId, userId));

  async function createCustomer(
    user: TestUser,
    overrides: Record<string, unknown> = {},
  ): Promise<string> {
    const res = await post(user, "/v1/customers", {
      name: "Odběratel a.s.",
      ico: "45274649",
      dic: "CZ45274649",
      vatPayer: true,
      email: BUYER_EMAIL,
      ...overrides,
    });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { id: string }).id;
  }

  /** Issue a quote for `user`, attached to `customerId`. */
  async function issueQuote(
    user: TestUser,
    customerId: string,
  ): Promise<{ id: string; shareToken: string; documentNumber: string }> {
    const res = await post(user, "/v1/quotes", { site: steppedSite, instances, customerId });
    expect(res.statusCode, res.body).toBe(201);
    return res.json() as { id: string; shareToken: string; documentNumber: string };
  }

  /** Issue → accept → order → invoice. */
  async function issueInvoice(
    user: TestUser,
    customerId: string,
  ): Promise<{ id: string; documentNumber: string }> {
    const quote = await issueQuote(user, customerId);
    await inject(app, {
      method: "POST",
      url: "/v1/quotes/shared/accept",
      payload: { token: quote.shareToken },
    });
    const order = (await post(user, "/v1/orders", { quoteId: quote.id })).json() as { id: string };
    const res = await post(user, "/v1/invoices", { orderId: order.id });
    expect(res.statusCode, res.body).toBe(201);
    return res.json() as { id: string; documentNumber: string };
  }

  const sendQuote = (user: TestUser, documentId: string) =>
    post(user, "/v1/deliveries", { documentType: "quote", documentId });

  beforeAll(async () => {
    app = await createApiApp((builder) =>
      builder.overrideProvider(EMAIL_SENDER).useValue({
        send: async (message: EmailMessage) => {
          sent.push(message);
        },
      }),
    );
    db = app.get<Db>(DB);
    tenant = await signUpUser(app, "delivery-tenant");
    await seedGoldenCorpusFor(app, db, tenant);
    await put(tenant, "/v1/org/legal-profile", { ...TEST_LEGAL_PROFILE, iban: TEST_IBAN });
    expect((await post(tenant, "/v1/price-tables", priceTableBody)).statusCode).toBe(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it("queues a send and returns a PII-FREE record", async () => {
    const customerId = await createCustomer(tenant);
    const quote = await issueQuote(tenant, customerId);

    const res = await sendQuote(tenant, quote.id);
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json() as DeliveryBody;
    expect(body.status).toBe("queued");
    expect(body.documentType).toBe("quote");
    expect(body.documentId).toBe(quote.id);
    expect(body.documentNumber).toBe(quote.documentNumber);
    expect(body.customerId).toBe(customerId);
    expect(body.sentAt).toBeNull();

    // The RAW body — the strip is the PII control, so assert on the wire text.
    expect(res.body).not.toContain(BUYER_EMAIL);
    expect(res.body).not.toContain("recipientEmail");
    expect(res.body).not.toContain("linkPath");
    expect(res.body).not.toContain("failureReason");
    expect(res.body).not.toContain("payToIban");
    expect(res.body).not.toContain(quote.shareToken);
  });

  it("the committed outbox payload has exactly one key: deliveryId", async () => {
    const customerId = await createCustomer(tenant);
    const quote = await issueQuote(tenant, customerId);
    const delivery = (await sendQuote(tenant, quote.id)).json() as DeliveryBody;

    const [row] = await db.select().from(outbox).where(eq(outbox.aggregateId, delivery.id));
    expect(row).toBeDefined();
    expect(row!.eventType).toBe(DOCUMENT_DELIVERY_REQUESTED);
    expect(row!.aggregateType).toBe("document_delivery");
    // IDs ONLY (ADR 0037) — Redis and the outbox stay non-PII-bearing.
    expect(Object.keys(row!.payload as Record<string, unknown>)).toEqual(["deliveryId"]);
    expect(JSON.stringify(row!.payload)).not.toContain(BUYER_EMAIL);
  });

  it("lists the send history of one document, still PII-free", async () => {
    const customerId = await createCustomer(tenant);
    const quote = await issueQuote(tenant, customerId);
    const delivery = (await sendQuote(tenant, quote.id)).json() as DeliveryBody;

    const res = await get(tenant, `/v1/deliveries?documentType=quote&documentId=${quote.id}`);
    expect(res.statusCode, res.body).toBe(200);
    const page = res.json() as { items: DeliveryBody[]; nextCursor: string | null };
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.id).toBe(delivery.id);
    expect(res.body).not.toContain(BUYER_EMAIL);
    expect(res.body).not.toContain("recipientEmail");
    expect(res.body).not.toContain("linkPath");
  });

  it("409 send_in_progress on an immediate second send of the same document", async () => {
    const customerId = await createCustomer(tenant);
    const quote = await issueQuote(tenant, customerId);
    expect((await sendQuote(tenant, quote.id)).statusCode).toBe(201);

    const second = await sendQuote(tenant, quote.id);
    expect(second.statusCode, second.body).toBe(409);
    expect((second.json() as { code?: string }).code).toBe("send_in_progress");
  });

  it("422 recipient_email_missing when the buyer has no address on record", async () => {
    const customerId = await createCustomer(tenant, { email: undefined });
    const quote = await issueQuote(tenant, customerId);

    const res = await sendQuote(tenant, quote.id);
    expect(res.statusCode, res.body).toBe(422);
    expect((res.json() as { code?: string }).code).toBe("recipient_email_missing");
  });

  it("422 customer_anonymized after an Art.17 erasure — never 'add an address'", async () => {
    const customerId = await createCustomer(tenant);
    const quote = await issueQuote(tenant, customerId);
    expect((await del(tenant, `/v1/customers/${customerId}`)).statusCode).toBe(204);

    const res = await sendQuote(tenant, quote.id);
    expect(res.statusCode, res.body).toBe(422);
    expect((res.json() as { code?: string }).code).toBe("customer_anonymized");
  });

  it("workshop is 403 on the whole surface (price-blind by ABSENCE)", async () => {
    const workshop = await signUpUser(app, "delivery-workshop");
    // Same org as the tenant is not needed — the role gate fires first.
    await setRole(workshop.id, "workshop");
    const res = await post(workshop, "/v1/deliveries", {
      documentType: "quote",
      documentId: "01890a5d-ac96-774b-bcce-b302099a0011",
    });
    expect(res.statusCode).toBe(403);
    expect((await get(workshop, "/v1/deliveries?documentType=quote&documentId=x")).statusCode).toBe(
      403,
    );
  });

  it("another org's rep gets a 404, never a 403 (no existence oracle)", async () => {
    const customerId = await createCustomer(tenant);
    const quote = await issueQuote(tenant, customerId);

    const outsider = await signUpUser(app, "delivery-outsider");
    const res = await sendQuote(outsider, quote.id);
    expect(res.statusCode, res.body).toBe(404);
  });

  it("the worker handler run TWICE sends exactly ONCE (the double-send guard)", async () => {
    const before = sent.length;
    const customerId = await createCustomer(tenant);
    const quote = await issueQuote(tenant, customerId);
    const delivery = (await sendQuote(tenant, quote.id)).json() as DeliveryBody;

    const handler = new DeliveriesEventsHandler(
      app.get(DeliveriesRepository),
      app.get(EmailService),
      app.get(ENV),
    );
    const event = {
      eventType: DOCUMENT_DELIVERY_REQUESTED,
      aggregateType: "document_delivery",
      aggregateId: delivery.id,
      payload: { deliveryId: delivery.id },
    };
    // `TransactionHost` resolves its client from CLS; the handler runs outside
    // any request, so give it a CLS context explicitly.
    const cls = app.get(ClsService);
    await cls.run(async () => {
      await handler.handle(event);
      await handler.handle(event);
    });

    const delivered = sent.slice(before);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.to).toBe(BUYER_EMAIL);
    expect(delivered[0]!.subject).toBe(`Vaše cenová nabídka ${quote.documentNumber}`);
    expect(delivered[0]!.html).toContain(`/nabidka#${quote.shareToken}`);

    const after = await get(tenant, `/v1/deliveries?documentType=quote&documentId=${quote.id}`);
    const row = (after.json() as { items: DeliveryBody[] }).items[0]!;
    expect(row.status).toBe("sent");
    expect(row.sentAt).not.toBeNull();
  });

  it("the invoice mail is a NOTIFICATION: no link anywhere, and it names the act", async () => {
    const before = sent.length;
    const customerId = await createCustomer(tenant);
    const invoice = await issueInvoice(tenant, customerId);

    const res = await post(tenant, "/v1/deliveries", {
      documentType: "invoice",
      documentId: invoice.id,
    });
    expect(res.statusCode, res.body).toBe(201);
    const delivery = res.json() as DeliveryBody;

    const handler = new DeliveriesEventsHandler(
      app.get(DeliveriesRepository),
      app.get(EmailService),
      app.get(ENV),
    );
    const cls = app.get(ClsService);
    await cls.run(() =>
      handler.handle({
        eventType: DOCUMENT_DELIVERY_REQUESTED,
        aggregateType: "document_delivery",
        aggregateId: delivery.id,
        payload: { deliveryId: delivery.id },
      }),
    );

    const delivered = sent.slice(before);
    expect(delivered).toHaveLength(1);
    const mail = delivered[0]!;
    expect(mail.to).toBe(BUYER_EMAIL);
    // The subject names the ACT, never the artifact (the ADR-0126 mislabel class).
    expect(mail.subject).toBe(`Vystavili jsme fakturu ${invoice.documentNumber}`);
    expect(mail.subject.toLowerCase()).not.toContain("daňový doklad");
    // The disclaimer is present, and there is NO link of any kind.
    const body = mailBody(mail.html);
    expect(body).toContain("není to daňový doklad");
    expect(body).not.toContain("http://");
    expect(body).not.toContain("https://");
    expect(body).not.toContain("href=");
    // The payment identification the buyer needs is inline.
    expect(body).toContain(invoice.documentNumber);
    expect(body).toContain(TEST_IBAN);
  });
});
