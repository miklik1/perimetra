/**
 * Invoice-issued NOTIFICATION email (ADR 0129, Wave A2). Like every template
 * here it is TRANSLATION-AGNOSTIC: the service translates via the shared
 * catalogs and passes final strings, so the template imports no i18n and
 * renders identically for any locale.
 *
 * PROVISIONAL (CAR-27 pass 2): the accountant pass has not run. This template is
 * a NOTIFICATION, not a daňový doklad, and its copy says so explicitly
 * (`notice`). Nothing here claims legal correctness or compliance. Adding a
 * link, an attachment, or a subject naming the artifact rather than the act
 * reopens the ADR-0126 mislabel class.
 *
 * By construction it therefore imports NO `Button` and exposes NO `href` prop:
 * a mail with no link cannot imply "the document is one click away". The
 * payment identification arrives as `rows` — already-translated label/value
 * pairs assembled by the service from the FROZEN ADR-0127 document projection,
 * with null-valued rows omitted rather than rendered empty (an absent figure is
 * absence, never a placeholder). `value` strings are printed verbatim; the money
 * row carries the kernel's own formatting so the mail and the §29 sheet cannot
 * disagree.
 */
import { Body, Container, Heading, Html, Text } from "@react-email/components";

/** File-local: the props interface below is the template's only public shape. */
interface InvoiceIssuedEmailRow {
  label: string;
  value: string;
}

export interface InvoiceIssuedEmailProps {
  lang: string;
  heading: string;
  body: string;
  rows: InvoiceIssuedEmailRow[];
  notice: string;
  footer: string;
}

export function InvoiceIssuedEmail(props: InvoiceIssuedEmailProps) {
  return (
    <Html lang={props.lang}>
      <Body style={{ fontFamily: "sans-serif", backgroundColor: "#f6f6f6" }}>
        <Container style={{ backgroundColor: "#ffffff", padding: "32px", borderRadius: "8px" }}>
          <Heading as="h2">{props.heading}</Heading>
          <Text>{props.body}</Text>
          {props.rows.map((row) => (
            <Text key={row.label} style={{ margin: "4px 0" }}>
              <strong>{row.label}</strong>
              {": "}
              {row.value}
            </Text>
          ))}
          {/* The honesty disclaimer is body copy, never fine print: it is the
              sentence that keeps the mail out of the ADR-0126 mislabel class,
              so it renders at full size in the container's own palette. */}
          <Text
            style={{
              backgroundColor: "#f6f6f6",
              borderLeft: "3px solid #111111",
              padding: "12px 16px",
              borderRadius: "4px",
            }}
          >
            {props.notice}
          </Text>
          <Text style={{ color: "#666666", fontSize: "12px" }}>{props.footer}</Text>
        </Container>
      </Body>
    </Html>
  );
}
