import nodemailer, { type Transporter } from "nodemailer";

import { type Env } from "../../common/config/env.js";
import { type EmailMessage, type EmailSender } from "./email.tokens.js";

export function createSmtpSender(env: Env): EmailSender {
  const transporter: Transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    // Implicit TLS only on 465; 587/1025 use STARTTLS/plain (Mailpit).
    secure: env.SMTP_PORT === 465,
    ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } } : {}),
  });

  return {
    async send(message: EmailMessage): Promise<void> {
      await transporter.sendMail({ from: env.EMAIL_FROM, ...message });
    },
  };
}
