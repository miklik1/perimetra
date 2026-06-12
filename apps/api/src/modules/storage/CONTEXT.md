# storage — S3 presigned upload/download (ADR 0035)

Direct-to-S3 file transfer: the api only signs URLs (AWS SDK v3), bytes never
flow through Node. MinIO in compose for dev (console <http://localhost:9001>).
`S3_ENDPOINT` must be BROWSER-reachable — presigned URLs embed it.

## Public surface

- `StorageService.presignUpload({ contentType, sizeBytes, … })` — validates
  against `ALLOWED_UPLOAD_TYPES` / `MAX_UPLOAD_BYTES` (`storage.tokens.ts`)
  BEFORE signing; constraints are baked into the signature.
- `StorageService.presignDownload(key, filename?)` — short-lived GET URL
  with content-disposition.
- `storage.controller.ts` — `/v1/storage/*` presign endpoints (guarded).

## Conventions

- Object keys are namespaced per owner — erasure (ADR 0040) must be able to
  find a user's objects by prefix.
- Orphaned-object hygiene: presigned-but-never-confirmed uploads are cleaned
  by a maintenance job; AV scanning is a seam on the upload-complete event.

## Must never

- Proxy file bytes through the api, or import domain module schemas.
- Sign for arbitrary content types/sizes — the allowlist is the control.

Governing ADR: `docs/adr/0035-infra-modules.md` (storage section).
