/**
 * nestjs-zod DTOs over the shared contracts (`@repo/validators/deliveries`) —
 * the classes give Nest something to hang pipe/serializer metadata on; the zod
 * schemas stay the single source of truth.
 *
 * `DeliveryDto`'s strip semantics are the REAL PII control of this module (ADR
 * 0039): `deliverySchema` declares no `recipientEmail`, no `linkPath` and no
 * `failureReason`, so those columns cannot reach a response body even if a
 * mapper regressed.
 */
import {
  deliveriesPageSchema,
  deliverySchema,
  listDeliveriesQuerySchema,
  sendDocumentSchema,
} from "@repo/validators/deliveries";

import { createZodDto } from "../../common/api/zod.js";

export class SendDocumentDto extends createZodDto(sendDocumentSchema) {}
export class ListDeliveriesQueryDto extends createZodDto(listDeliveriesQuerySchema) {}

/** Response DTOs — used with `@ZodSerializerDto` (strip semantics, spec §8). */
export class DeliveryDto extends createZodDto(deliverySchema) {}
export class DeliveriesPageDto extends createZodDto(deliveriesPageSchema) {}
