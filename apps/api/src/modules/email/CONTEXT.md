# email — locale-aware transactional email (ADR 0035)

Provider-agnostic email seam: react-email templates rendered through the
shared ICU catalogs (`@repo/i18n`), so mail arrives in the recipient's
`locale` (EU table stakes). Dev delivery goes to Mailpit
(<http://localhost:8025>) via the compose stack.

## Public surface

- `EmailService` — typed senders per template (e.g.
  `sendVerificationEmail({ to, locale, … })`). Add a template + a typed
  method; callers never touch SMTP.
- `EMAIL_SENDER` token + `EmailSender`/`EmailMessage` interface
  (`email.tokens.ts`) — the swap point for a provider adapter (SES, Resend,
  …). `smtp.sender.ts` (nodemailer) is the default implementation.
- `templates/` — react-email components; `translator.ts` bridges `use-intl`
  to template rendering.

### Buyer-facing document mail (ADR 0129, Wave A2)

Two senders, both called by the `deliveries` WORKER handler — never inline in
a request path, so a slow or failing SMTP hop can neither fail nor stall a
rep's action:

- `sendQuoteIssuedEmail({ to, documentNumber, quoteUrl, locale })` — genuinely
  DELIVERS the nabídka. `quoteUrl` is the absolute form of the shipped
  ADR-0089 public landing `/nabidka/:shareToken`, which renders the full
  priced document and offers accept/decline, so the subject's claim is fully
  backed by the payload.
- `sendInvoiceIssuedEmail({ to, documentNumber, variableSymbol, amount,
currency, dueDate, iban, locale })` — a NOTIFICATION, not the document.

**The A2 honesty rule for the invoice mail** (ADR 0126's mislabel class,
inverted onto e-mail; PROVISIONAL — the CAR-27 accountant pass has not run, so
nothing in this copy claims legal correctness or compliance):

1. The subject names the ACT (`Vystavili jsme fakturu {number}`), never the
   artifact — it must never contain "daňový doklad".
2. The body carries the explicit disclaimer that this is an oznámení and not
   the daňový doklad, and that the rep hands over the document itself.
3. The mail carries NO link and NO button, by construction: the template
   imports no `Button` and exposes no `href` prop.

All three are pinned by `email.service.test.ts`. Adding a link, an attachment,
or a subject naming the artifact reopens the mislabel class.

`amount` is the kernel's own `InvoiceDocument.totalAmount` string, interpolated
VERBATIM — money formatting is kernel-owned, so the mail prints exactly what
the §29 sheet prints (dot-decimal in a Czech mail is a deliberate accepted
cost, not an oversight). `dueDate` arrives ALREADY FORMATTED for the resolved
locale; the caller owns the UTC-pinned calendar-date rule (ADR 0105). A null
`dueDate`/`iban` OMITS its row rather than rendering an empty or placeholder
value — absence, never masking.

## Must never

- Be called with a hardcoded locale — the user record carries `locale`.
- Import domain schemas; callers pass the data the template needs.
- Be bypassed with raw nodemailer elsewhere — the seam is the point
  (provider swap, testing, and redaction all hang off it).
- Gain a logger here or in `smtp.sender.ts`. A rejected-recipient SMTP error
  (a 550) routinely embeds the address, and neither the pino body paths nor
  the Sentry scrubber reaches an exception message. The seam therefore THROWS
  and the caller decides — `DeliveriesEventsHandler` catches, persists the
  normalized code `smtp_error`, and logs an id, never the error (ADR 0129).

Governing ADR: `docs/adr/0035-infra-modules.md` (email section).
