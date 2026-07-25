/**
 * Deliveries controller (ADR 0129) — the rep-facing "send this document to its
 * buyer" surface. Conventions:
 * - The global SessionGuard (APP_GUARD, ADR 0099) authenticates every route and
 *   the class `RolesGuard` (ADR 0056) resolves the caller's org role. There is
 *   NO `@Public()` anywhere in this module: A2 adds ZERO new public/anonymous
 *   surfaces (the quote mail links the ALREADY-SHIPPED ADR-0089 landing; the
 *   invoice mail links nothing at all).
 * - Both routes are `@RequireRole("admin","sales")`. `workshop` gets a 403 — it
 *   is price-blind by ABSENCE and must not transmit commercial documents.
 * - Both pass `@CurrentRole()` down so the service applies the per-rep ownership
 *   narrowing (ADR 0082) on top of the org scope.
 * - `@ZodSerializerDto` validates + STRIPS every response — and on this module
 *   the strip IS the PII control (the recipient address, the share-link and the
 *   SMTP failure text are not in `deliverySchema` at all).
 * - `@Idempotent()` on the send POST. AUTHORIZATION INVARIANT: the role check
 *   lives in `RolesGuard` (a guard), so it survives a replay; the per-rep
 *   ownership narrowing lives in the service and is therefore skipped on a
 *   replay — a strictly NARROWER residual than the already-accepted
 *   `POST /v1/invoices` case (same user, same path incl. the document id, 24h).
 * - Method-level `@Throttle` on the send: it burns an OUTWARD, non-undoable
 *   resource, so it gets the tightest tier in the codebase. The read stays on
 *   the global tier — the abuse surface is the send, not the history. NB the
 *   throttler keys per user-or-IP, so it bounds VOLUME, never repeat-to-one-
 *   buyer; that is the delivery record's job.
 */
import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";

import { type DeliveriesPage, type Delivery } from "@repo/validators/deliveries";

import { ZodSerializerDto } from "../../common/api/zod.js";
import { Idempotent } from "../../common/idempotency/idempotent.decorator.js";
import { CurrentRole } from "../../common/rbac/current-role.decorator.js";
import { type OrgRole } from "../../common/rbac/org-role.js";
import { RequireRole } from "../../common/rbac/require-role.decorator.js";
import { CurrentScope } from "../../common/tenancy/current-scope.decorator.js";
import { type RequestScope } from "../../common/tenancy/request-scope.js";
import { RolesGuard } from "../auth/roles.guard.js";
import {
  DeliveriesPageDto,
  DeliveryDto,
  ListDeliveriesQueryDto,
  SendDocumentDto,
} from "./deliveries.dto.js";
import { DeliveriesService } from "./deliveries.service.js";

@Controller("deliveries")
@UseGuards(RolesGuard)
export class DeliveriesController {
  constructor(private readonly deliveries: DeliveriesService) {}

  /** The send history of ONE document — both filters REQUIRED (there is
   *  deliberately no org-wide delivery feed). */
  @Get()
  @RequireRole("admin", "sales")
  @ZodSerializerDto(DeliveriesPageDto)
  list(
    @CurrentScope() scope: RequestScope,
    @CurrentRole() role: OrgRole,
    @Query() query: ListDeliveriesQueryDto,
  ): Promise<DeliveriesPage> {
    return this.deliveries.list(scope, role, query);
  }

  /** Queue a send. 201 with a PII-free record; the worker does the SMTP hop. */
  @Post()
  @RequireRole("admin", "sales")
  @Idempotent()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ZodSerializerDto(DeliveryDto)
  send(
    @CurrentScope() scope: RequestScope,
    @CurrentRole() role: OrgRole,
    @Body() body: SendDocumentDto,
  ): Promise<Delivery> {
    return this.deliveries.send(scope, role, body);
  }
}
