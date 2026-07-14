/**
 * nestjs-zod DTOs over the shared ledger contracts (`@repo/validators/ledger`).
 * The ledger is a read + recurrence-report surface (no CRUD): one query DTO +
 * one response DTO. The order-exception WRITE rides the orders controller.
 */
import { ledgerPageSchema, listLedgerQuerySchema } from "@repo/validators/ledger";

import { createZodDto } from "../../common/api/zod.js";

export class ListLedgerQueryDto extends createZodDto(listLedgerQuerySchema) {}

/** Response DTO — used with `@ZodSerializerDto` (strip semantics, spec §8). */
export class LedgerPageDto extends createZodDto(ledgerPageSchema) {}
