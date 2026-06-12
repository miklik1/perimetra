export const EMAIL_SENDER = Symbol("EMAIL_SENDER");

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Provider-agnostic delivery seam (spec §7.4): SMTP in the skeleton
 * (Mailpit locally), a provider API adapter is a drop-in swap per project.
 */
export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}
