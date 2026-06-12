import { Module } from "@nestjs/common";

import { ENV, type Env } from "../../common/config/env.js";
import { EmailService } from "./email.service.js";
import { EMAIL_SENDER } from "./email.tokens.js";
import { createSmtpSender } from "./smtp.sender.js";

/**
 * Email seam (spec §7.4): provider-agnostic `EMAIL_SENDER` + the typed
 * `EmailService` rendering react-email templates in the user's locale over
 * the shared ICU catalogs. SMTP adapter (Mailpit-compatible) by default.
 */
@Module({
  providers: [
    { provide: EMAIL_SENDER, useFactory: (env: Env) => createSmtpSender(env), inject: [ENV] },
    EmailService,
  ],
  exports: [EmailService, EMAIL_SENDER],
})
export class EmailModule {}
