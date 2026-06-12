/**
 * S3 presigned-URL storage (spec §7.5). The api never proxies bytes — clients
 * PUT/GET directly against object storage with short-lived signed URLs.
 *
 * Hygiene encoded here:
 * - content type + length are SIGNED into the upload URL (`signableHeaders`),
 *   so a client can't lie about either;
 * - keys follow `<module>/<entityId>/<uuid>` — listable per entity, and the
 *   privacy module can erase per aggregate (ADR 0040);
 * - presigned-but-never-confirmed uploads are orphans: the maintenance
 *   cleanup seam (registerOrphanCleanup) reconciles bucket vs DB per module.
 */
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Inject, Injectable } from "@nestjs/common";
import { uuidv7 } from "uuidv7";

import { ENV, type Env } from "../../common/config/env.js";
import { S3_CLIENT } from "./storage.tokens.js";

const UPLOAD_URL_TTL_S = 300;
const DOWNLOAD_URL_TTL_S = 900;

@Injectable()
export class StorageService {
  constructor(
    @Inject(S3_CLIENT) private readonly s3: S3Client,
    @Inject(ENV) private readonly env: Env,
  ) {}

  buildKey(module: string, entityId: string): string {
    return `${module}/${entityId}/${uuidv7()}`;
  }

  async presignUpload(input: {
    key: string;
    contentType: string;
    contentLength: number;
  }): Promise<{ url: string; key: string; expiresInSeconds: number }> {
    const command = new PutObjectCommand({
      Bucket: this.env.S3_BUCKET,
      Key: input.key,
      ContentType: input.contentType,
      ContentLength: input.contentLength,
    });
    const url = await getSignedUrl(this.s3, command, {
      expiresIn: UPLOAD_URL_TTL_S,
      // Non-x-amz-* headers are only enforced when listed here — this is what
      // makes contentType/contentLength cryptographic, not advisory.
      signableHeaders: new Set(["content-type", "content-length"]),
    });
    return { url, key: input.key, expiresInSeconds: UPLOAD_URL_TTL_S };
  }

  async presignDownload(key: string, filename?: string): Promise<string> {
    return await getSignedUrl(
      this.s3,
      new GetObjectCommand({
        Bucket: this.env.S3_BUCKET,
        Key: key,
        ...(filename ? { ResponseContentDisposition: `attachment; filename="${filename}"` } : {}),
      }),
      { expiresIn: DOWNLOAD_URL_TTL_S },
    );
  }
}
