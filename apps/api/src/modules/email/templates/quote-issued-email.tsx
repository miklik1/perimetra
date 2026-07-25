/**
 * Quote-issued email (ADR 0129, Wave A2). Like every template here it is
 * TRANSLATION-AGNOSTIC: the service translates via the shared catalogs and
 * passes final strings, so the template imports no i18n and renders identically
 * for any locale.
 *
 * This mail genuinely DELIVERS the nabídka: `quoteUrl` targets the shipped
 * ADR-0089 public landing `/nabidka/:shareToken`, which renders the full priced
 * document off the frozen snapshot and offers accept/decline. The copy therefore
 * claims exactly three things — a quotation exists, the button opens it, it can
 * be accepted or declined there — and all three are backed by the payload. It
 * deliberately states no validity date (the landing owns `validUntil` and its
 * expired banner; a restated deadline could disagree across a timezone
 * boundary), no price, no supplier name and no legal characterisation.
 */
import { Body, Button, Container, Heading, Html, Text } from "@react-email/components";

export interface QuoteIssuedEmailProps {
  lang: string;
  heading: string;
  body: string;
  button: string;
  footer: string;
  quoteUrl: string;
}

export function QuoteIssuedEmail(props: QuoteIssuedEmailProps) {
  return (
    <Html lang={props.lang}>
      <Body style={{ fontFamily: "sans-serif", backgroundColor: "#f6f6f6" }}>
        <Container style={{ backgroundColor: "#ffffff", padding: "32px", borderRadius: "8px" }}>
          <Heading as="h2">{props.heading}</Heading>
          <Text>{props.body}</Text>
          <Button
            href={props.quoteUrl}
            style={{
              backgroundColor: "#111111",
              color: "#ffffff",
              padding: "12px 20px",
              borderRadius: "6px",
            }}
          >
            {props.button}
          </Button>
          <Text style={{ color: "#666666", fontSize: "12px" }}>{props.footer}</Text>
        </Container>
      </Body>
    </Html>
  );
}
