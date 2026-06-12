/**
 * Email templates are TRANSLATION-AGNOSTIC: they take final strings as props
 * (the service translates via the shared catalogs), so a template never
 * imports i18n and renders identically for any locale.
 */
import { Body, Button, Container, Heading, Html, Text } from "@react-email/components";

export interface VerificationEmailProps {
  lang: string;
  heading: string;
  body: string;
  button: string;
  ignore: string;
  verifyUrl: string;
}

export function VerificationEmail(props: VerificationEmailProps) {
  return (
    <Html lang={props.lang}>
      <Body style={{ fontFamily: "sans-serif", backgroundColor: "#f6f6f6" }}>
        <Container style={{ backgroundColor: "#ffffff", padding: "32px", borderRadius: "8px" }}>
          <Heading as="h2">{props.heading}</Heading>
          <Text>{props.body}</Text>
          <Button
            href={props.verifyUrl}
            style={{
              backgroundColor: "#111111",
              color: "#ffffff",
              padding: "12px 20px",
              borderRadius: "6px",
            }}
          >
            {props.button}
          </Button>
          <Text style={{ color: "#666666", fontSize: "12px" }}>{props.ignore}</Text>
        </Container>
      </Body>
    </Html>
  );
}
