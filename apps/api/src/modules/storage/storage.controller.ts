import { BadRequestException, Body, Controller, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";

import { CurrentSession } from "../auth/current-session.decorator.js";
import { SessionGuard, type SessionContext } from "../auth/session.guard.js";
import { StorageService } from "./storage.service.js";
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES } from "./storage.tokens.js";

const presignUploadSchema = z.object({
  contentType: z.enum(ALLOWED_UPLOAD_TYPES),
  contentLength: z.number().int().positive().max(MAX_UPLOAD_BYTES),
});

@Controller("storage")
@UseGuards(SessionGuard)
export class StorageController {
  constructor(private readonly storage: StorageService) {}

  /**
   * Hand-rolled zod parse — predates the repo-wide nestjs-zod DTO + 422
   * field-error convention (ADR 0039); migrate when next touching this
   * controller.
   */
  @Post("presign-upload")
  async presignUpload(
    @Body() body: unknown,
    @CurrentSession() session: SessionContext,
  ): Promise<{ url: string; key: string; expiresInSeconds: number }> {
    const parsed = presignUploadSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: "Invalid presign request",
        code: "validation",
        errors: Object.fromEntries(
          parsed.error.issues.map((issue) => [issue.path.join("."), [issue.message]]),
        ),
      });
    }

    // Uploads are keyed under the requesting user until domain modules pass
    // their own aggregate ids (the tenancy seam, ADR 0041, scopes this further).
    const key = this.storage.buildKey("uploads", session.user.id);
    return await this.storage.presignUpload({ key, ...parsed.data });
  }
}
