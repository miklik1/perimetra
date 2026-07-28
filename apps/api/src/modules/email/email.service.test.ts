import { describe, expect, it, vi } from "vitest";

import { EmailService } from "./email.service.js";
import { type EmailMessage } from "./email.tokens.js";

function makeService() {
  const sent: EmailMessage[] = [];
  const service = new EmailService({
    send: vi.fn(async (message: EmailMessage) => {
      sent.push(message);
    }),
  });
  return { service, sent };
}

/**
 * react-email's `render` prepends the XHTML-transitional DOCTYPE, whose PUBLIC
 * identifier is itself a `http://www.w3.org/…` URL. Strip it so the ADR-0129
 * "this mail carries NO link" assertions test the MAIL, not react-email's
 * boilerplate.
 */
function mailBody(html: string): string {
  return html.replace(/^<!DOCTYPE[^>]*>/, "");
}

describe("EmailService.sendVerificationEmail", () => {
  it("renders the Czech catalog by default (cs-first, ADR 0020)", async () => {
    const { service, sent } = makeService();
    await service.sendVerificationEmail({
      to: "user@example.test",
      name: "Martin",
      verifyUrl: "https://app.test/verify?token=t",
      locale: undefined,
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toBe("Potvrďte svou e-mailovou adresu");
    expect(sent[0]!.html).toContain("Vítejte, Martin!");
    expect(sent[0]!.html).toContain("https://app.test/verify?token=t");
    expect(sent[0]!.text).toContain("Potvrďte prosím");
  });

  it("renders English for locale=en and falls back for unknown locales", async () => {
    const { service, sent } = makeService();
    await service.sendVerificationEmail({
      to: "a@b.test",
      name: "Ana",
      verifyUrl: "https://x.test",
      locale: "en",
    });
    await service.sendVerificationEmail({
      to: "a@b.test",
      name: "Ana",
      verifyUrl: "https://x.test",
      locale: "klingon",
    });

    expect(sent[0]!.subject).toBe("Confirm your email address");
    expect(sent[1]!.subject).toBe("Potvrďte svou e-mailovou adresu");
  });
});

describe("EmailService.sendQuoteIssuedEmail (ADR 0129)", () => {
  it("names the document and links the ADR-0089 public landing", async () => {
    const { service, sent } = makeService();
    await service.sendQuoteIssuedEmail({
      to: "buyer@example.cz",
      documentNumber: "2026/0007",
      quoteUrl: "https://app.test/nabidka#tok_abc123",
      locale: null,
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toBe("Vaše cenová nabídka 2026/0007");
    expect(sent[0]!.html).toContain("2026/0007");
    // The mail genuinely DELIVERS the nabídka: the button targets the shipped
    // public landing, so the subject's claim is backed by the payload.
    expect(sent[0]!.html).toContain("https://app.test/nabidka#tok_abc123");
    expect(sent[0]!.text.trim().length).toBeGreaterThan(0);
    expect(sent[0]!.text).toContain("Připravili jsme pro vás cenovou nabídku 2026/0007");
  });

  /**
   * ADR 0130. The whole design rests on the fragment SURVIVING the trip to the
   * buyer's mail client, so the parts of that trip we own are pinned here: the
   * `@react-email` `<Button href>` render and the HTML→plain-text conversion,
   * either of which could plausibly normalise or truncate a `#`.
   *
   * The part we do NOT own — a mail gateway that rewrites links (Microsoft Safe
   * Links, Proofpoint, Mimecast) — cannot be tested from this repo, and a
   * gateway that dropped the fragment would turn every mailed link into a dead
   * `/nabidka`. That check is a MANUAL pre-deploy step in the deploy runbook
   * (`docs/operations/deploy.md`), deliberately recorded as owed rather than
   * faked with a green unit test.
   */
  it("carries the URL fragment intact into BOTH the html and the plain-text part", async () => {
    const { service, sent } = makeService();
    const url = "https://app.test/nabidka#tok_abc123";
    await service.sendQuoteIssuedEmail({
      to: "buyer@example.cz",
      documentNumber: "2026/0007",
      quoteUrl: url,
      locale: null,
    });

    expect(sent[0]!.html).toContain(url);
    expect(sent[0]!.text).toContain(url);
    // Not merely "contains a #": the token must be the LAST thing on the URL, so
    // a conversion that kept the fragment marker but dropped what follows it
    // reds here rather than shipping a link that resolves to nothing.
    expect(sent[0]!.text).toContain("#tok_abc123");
    expect(sent[0]!.html).not.toContain("/nabidka/tok_abc123");
  });

  it("renders English for locale=en and falls back for unknown locales", async () => {
    const { service, sent } = makeService();
    await service.sendQuoteIssuedEmail({
      to: "buyer@example.cz",
      documentNumber: "2026/0007",
      quoteUrl: "https://app.test/nabidka#tok_abc123",
      locale: "en",
    });
    await service.sendQuoteIssuedEmail({
      to: "buyer@example.cz",
      documentNumber: "2026/0007",
      quoteUrl: "https://app.test/nabidka#tok_abc123",
      locale: "klingon",
    });

    expect(sent[0]!.subject).toBe("Your quotation 2026/0007");
    expect(sent[1]!.subject).toBe("Vaše cenová nabídka 2026/0007");
  });
});

describe("EmailService.sendInvoiceIssuedEmail (ADR 0129)", () => {
  const input = {
    to: "buyer@example.cz",
    documentNumber: "FV2026/0003",
    variableSymbol: "20260003",
    amount: "129891.504",
    currency: "CZK",
    dueDate: "31. července 2026",
    iban: "CZ6508000000192000145399",
    locale: null,
  };

  // The four regression pins for the ADR-0126 mislabel class, inverted onto
  // e-mail (ADR 0129 constraint 5): this mail is a NOTIFICATION and must never
  // present itself as, or appear to carry, the daňový doklad.
  it("names the ACT, never the artifact — the subject says no 'daňový doklad'", async () => {
    const { service, sent } = makeService();
    await service.sendInvoiceIssuedEmail(input);

    expect(sent[0]!.subject).toBe("Vystavili jsme fakturu FV2026/0003");
    expect(sent[0]!.subject.toLowerCase()).not.toContain("daňový doklad");
  });

  it("states in the body that it is NOT the daňový doklad", async () => {
    const { service, sent } = makeService();
    await service.sendInvoiceIssuedEmail(input);

    expect(sent[0]!.html).toContain("není to daňový doklad");
    expect(sent[0]!.text).toContain("není to daňový doklad");
  });

  it("carries no link at all — a mail with no link cannot imply the document is one click away", async () => {
    const { service, sent } = makeService();
    await service.sendInvoiceIssuedEmail(input);

    const body = mailBody(sent[0]!.html);
    expect(body).not.toContain("http://");
    expect(body).not.toContain("https://");
    expect(body).not.toContain("href=");
    expect(body).not.toContain("<a ");
    expect(sent[0]!.text).not.toContain("http");
  });

  it("carries the payment identification inline, with the kernel money string verbatim", async () => {
    const { service, sent } = makeService();
    await service.sendInvoiceIssuedEmail(input);

    expect(sent[0]!.html).toContain("FV2026/0003");
    expect(sent[0]!.html).toContain("Variabilní symbol");
    expect(sent[0]!.html).toContain("20260003");
    // Money formatting is kernel-owned: the mail prints exactly what the §29
    // sheet prints — no thousands separator, no ICU number formatting.
    expect(sent[0]!.html).toContain("129891.504 CZK");
    expect(sent[0]!.html).toContain("CZ6508000000192000145399");
    expect(sent[0]!.html).toContain("31. července 2026");
  });

  it("OMITS a null due date / IBAN row rather than rendering an empty value", async () => {
    const { service, sent } = makeService();
    await service.sendInvoiceIssuedEmail({ ...input, dueDate: null, iban: null });

    expect(sent[0]!.html).not.toContain("Splatnost");
    expect(sent[0]!.html).not.toContain("IBAN");
    // Structural proof that the row is DROPPED, not rendered with an empty or
    // placeholder value: `<strong>` is used only for a row label, so exactly the
    // three valued rows survive.
    expect(sent[0]!.html.match(/<strong>/g)).toHaveLength(3);
    // The rows that DO have values are unaffected.
    expect(sent[0]!.html).toContain("Variabilní symbol");
    expect(sent[0]!.html).toContain("129891.504 CZK");
  });

  it("renders English for locale=en and falls back for unknown locales", async () => {
    const { service, sent } = makeService();
    await service.sendInvoiceIssuedEmail({ ...input, locale: "en" });
    await service.sendInvoiceIssuedEmail({ ...input, locale: "klingon" });

    expect(sent[0]!.subject).toBe("We've issued invoice FV2026/0003");
    expect(sent[0]!.html).toContain("It is not the tax document itself");
    expect(sent[1]!.subject).toBe("Vystavili jsme fakturu FV2026/0003");
  });
});
