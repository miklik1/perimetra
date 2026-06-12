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
