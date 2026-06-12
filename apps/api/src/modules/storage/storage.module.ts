import { S3Client } from "@aws-sdk/client-s3";
import { Module } from "@nestjs/common";

import { ENV, type Env } from "../../common/config/env.js";
import { AuthModule } from "../auth/auth.module.js";
import { StorageController } from "./storage.controller.js";
import { StorageService } from "./storage.service.js";
import { S3_CLIENT } from "./storage.tokens.js";

@Module({
  imports: [AuthModule],
  controllers: [StorageController],
  providers: [
    {
      provide: S3_CLIENT,
      useFactory: (env: Env) =>
        new S3Client({
          endpoint: env.S3_ENDPOINT,
          // MinIO serves /bucket/key, not virtual-host buckets.
          forcePathStyle: true,
          region: env.S3_REGION,
          credentials: {
            accessKeyId: env.S3_ACCESS_KEY,
            secretAccessKey: env.S3_SECRET_KEY,
          },
          // Older MinIO releases reject the SDK's default flexible checksums.
          requestChecksumCalculation: "WHEN_REQUIRED",
          responseChecksumValidation: "WHEN_REQUIRED",
        }),
      inject: [ENV],
    },
    StorageService,
  ],
  exports: [StorageService],
})
export class StorageModule {}
