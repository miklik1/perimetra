export const S3_CLIENT = Symbol("S3_CLIENT");

/** Default presign allowlist — extend per project, never remove the check. */
export const ALLOWED_UPLOAD_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "application/pdf",
] as const;

/** 10 MB default upload ceiling (presigned PUT enforces it cryptographically). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
