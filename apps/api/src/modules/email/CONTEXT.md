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

## Must never

- Be called with a hardcoded locale — the user record carries `locale`.
- Import domain schemas; callers pass the data the template needs.
- Be bypassed with raw nodemailer elsewhere — the seam is the point
  (provider swap, testing, and redaction all hang off it).

Governing ADR: `docs/adr/0035-infra-modules.md` (email section).
