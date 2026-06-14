import { Inject, Injectable } from "@nestjs/common";
import { render, toPlainText } from "@react-email/render";

import { EMAIL_SENDER, type EmailSender } from "./email.tokens.js";
import { InvitationEmail } from "./templates/invitation-email.js";
import { VerificationEmail } from "./templates/verification-email.js";
import { getEmailTranslator, resolveLocale } from "./translator.js";

@Injectable()
export class EmailService {
  constructor(@Inject(EMAIL_SENDER) private readonly sender: EmailSender) {}

  /** Better Auth's verification hook lands here (ADR 0033 stub replaced). */
  async sendVerificationEmail(input: {
    to: string;
    name: string;
    verifyUrl: string;
    locale?: string | null;
  }): Promise<void> {
    const t = getEmailTranslator(input.locale);
    const html = await render(
      VerificationEmail({
        lang: resolveLocale(input.locale),
        heading: t("verification.heading", { name: input.name }),
        body: t("verification.body"),
        button: t("verification.button"),
        ignore: t("verification.ignore"),
        verifyUrl: input.verifyUrl,
      }),
    );

    await this.sender.send({
      to: input.to,
      subject: t("verification.subject"),
      html,
      text: toPlainText(html),
    });
  }

  /**
   * Better Auth's org-plugin `sendInvitationEmail` hook lands here (ADR 0057).
   * The invitee may not have an account yet (no `user.locale`), so delivery
   * falls back to the default locale unless an explicit `locale` is passed.
   */
  async sendInvitationEmail(input: {
    to: string;
    inviterName: string;
    orgName: string;
    acceptUrl: string;
    locale?: string | null;
  }): Promise<void> {
    const t = getEmailTranslator(input.locale);
    const html = await render(
      InvitationEmail({
        lang: resolveLocale(input.locale),
        heading: t("invitation.heading", { org: input.orgName }),
        body: t("invitation.body", { inviter: input.inviterName, org: input.orgName }),
        button: t("invitation.button"),
        ignore: t("invitation.ignore"),
        acceptUrl: input.acceptUrl,
      }),
    );

    await this.sender.send({
      to: input.to,
      subject: t("invitation.subject", { org: input.orgName }),
      html,
      text: toPlainText(html),
    });
  }
}
