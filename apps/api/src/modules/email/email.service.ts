import { Inject, Injectable } from "@nestjs/common";
import { render, toPlainText } from "@react-email/render";

import { EMAIL_SENDER, type EmailSender } from "./email.tokens.js";
import { InvitationEmail } from "./templates/invitation-email.js";
import { InvoiceIssuedEmail } from "./templates/invoice-issued-email.js";
import { QuoteIssuedEmail } from "./templates/quote-issued-email.js";
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

  /**
   * The buyer-facing "here is your nabídka" mail (ADR 0129, Wave A2). Called by
   * the deliveries worker handler, never inline in a request path.
   *
   * It genuinely DELIVERS the document: `quoteUrl` is the absolute form of the
   * shipped ADR-0089 public landing `/nabidka#<shareToken>`, which renders the
   * full priced nabídka and offers accept/decline — so the subject's claim is
   * fully backed by the payload.
   */
  async sendQuoteIssuedEmail(input: {
    to: string;
    documentNumber: string;
    quoteUrl: string;
    locale?: string | null;
  }): Promise<void> {
    const t = getEmailTranslator(input.locale);
    const html = await render(
      QuoteIssuedEmail({
        lang: resolveLocale(input.locale),
        heading: t("quoteIssued.heading", { number: input.documentNumber }),
        body: t("quoteIssued.body", { number: input.documentNumber }),
        button: t("quoteIssued.button"),
        footer: t("quoteIssued.footer"),
        quoteUrl: input.quoteUrl,
      }),
    );

    await this.sender.send({
      to: input.to,
      subject: t("quoteIssued.subject", { number: input.documentNumber }),
      html,
      text: toPlainText(html),
    });
  }

  /**
   * The buyer-facing "an invoice has been issued" mail (ADR 0129, Wave A2).
   *
   * PROVISIONAL (CAR-27 pass 2): the accountant pass has not run. This is a
   * NOTIFICATION, not a daňový doklad — the subject names the ACT, the body
   * carries an explicit disclaimer, and the mail carries no link and no
   * attachment. Nothing here claims legal correctness or compliance. Changing
   * any of those three reopens the ADR-0126 mislabel class.
   *
   * `amount` is the kernel's own `InvoiceDocument.totalAmount` string and is
   * interpolated VERBATIM — money formatting is kernel-owned, so the mail prints
   * exactly what the §29 sheet prints. `dueDate` arrives ALREADY FORMATTED for
   * the resolved locale (the caller owns the UTC-pinned calendar-date rule,
   * ADR 0105). A null `dueDate`/`iban` OMITS its row rather than rendering an
   * empty or placeholder value.
   */
  async sendInvoiceIssuedEmail(input: {
    to: string;
    documentNumber: string;
    variableSymbol: string;
    amount: string;
    currency: string;
    dueDate: string | null;
    iban: string | null;
    locale?: string | null;
  }): Promise<void> {
    const t = getEmailTranslator(input.locale);
    const rows = [
      { label: t("invoiceIssued.labelNumber"), value: input.documentNumber },
      { label: t("invoiceIssued.labelVariableSymbol"), value: input.variableSymbol },
      { label: t("invoiceIssued.labelAmount"), value: `${input.amount} ${input.currency}` },
      ...(input.dueDate ? [{ label: t("invoiceIssued.labelDueDate"), value: input.dueDate }] : []),
      ...(input.iban ? [{ label: t("invoiceIssued.labelIban"), value: input.iban }] : []),
    ];

    const html = await render(
      InvoiceIssuedEmail({
        lang: resolveLocale(input.locale),
        heading: t("invoiceIssued.heading", { number: input.documentNumber }),
        body: t("invoiceIssued.body", { number: input.documentNumber }),
        rows,
        notice: t("invoiceIssued.notice"),
        footer: t("invoiceIssued.footer"),
      }),
    );

    await this.sender.send({
      to: input.to,
      subject: t("invoiceIssued.subject", { number: input.documentNumber }),
      html,
      text: toPlainText(html),
    });
  }
}
