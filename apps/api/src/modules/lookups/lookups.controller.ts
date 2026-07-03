/**
 * Registry-lookup controller (ADR 0090) — IČO→ARES prefill + DIČ→VIES validation
 * behind the api. The global SessionGuard (ADR 0099) authenticates; RolesGuard +
 * @RequireRole gate it to
 * admin/sales (the same commercial surface as customers; workshop is 403 and never
 * touches buyer/supplier data). `@Throttle` caps the per-user rate so the endpoint
 * can't be turned into an upstream-quota battering ram (ARES is 500/min per IP).
 *
 * POST, not GET: the lookup KEY travels in the BODY, never the URL — so the
 * IČO/DIČ (a `pii()` value) stays out of the request log (pino-http logs `req.url`
 * but not the body), out of browser history, and out of any proxy access log. The
 * route is a pure read (no state change, no @Idempotent), so it returns 200, not
 * the POST-default 201. No `@CurrentScope()`: a public-register proxy touches no
 * org-scoped table. Every response strips through `@ZodSerializerDto`.
 */
import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";

import { type AresLookup, type ViesLookup } from "@repo/validators/lookups";

import { ZodSerializerDto } from "../../common/api/zod.js";
import { RequireRole } from "../../common/rbac/require-role.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import {
  AresLookupDto,
  AresLookupRequestDto,
  ViesLookupDto,
  ViesLookupRequestDto,
} from "./lookups.dto.js";
import { LookupsService } from "./lookups.service.js";

@Controller("lookups")
@UseGuards(RolesGuard)
@RequireRole("admin", "sales")
// Generous-but-bounded: plenty for manual entry, a hard ceiling on quota abuse.
@Throttle({ default: { ttl: 60_000, limit: 30 } })
export class LookupsController {
  constructor(private readonly lookups: LookupsService) {}

  /** IČO → ARES subject (name/address/DIČ). 400 on a malformed IČO. */
  @Post("ares")
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(AresLookupDto)
  ares(@Body() body: AresLookupRequestDto): Promise<AresLookup> {
    return this.lookups.lookupAres(body.ico);
  }

  /** DIČ → VIES validity. 400 on a malformed DIČ. */
  @Post("vies")
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(ViesLookupDto)
  vies(@Body() body: ViesLookupRequestDto): Promise<ViesLookup> {
    return this.lookups.lookupVies(body.dic);
  }
}
