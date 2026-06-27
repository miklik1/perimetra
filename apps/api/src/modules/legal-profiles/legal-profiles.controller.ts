/**
 * Legal-profiles controller (ADR 0088) — the org's SINGLETON legal identity at
 * `/v1/org/legal-profile` (no `:id`, no list, no pagination: the org IS the key,
 * from `@CurrentScope()`). SessionGuard authenticates; RolesGuard + @RequireRole
 * gate the whole surface to admin (Better Auth's org `owner` maps to `admin`) —
 * the legal identity is an org-administration concern, not a per-rep one. Sales/
 * workshop are 403'd; they never need the LIVE profile (the issued nabídka reads
 * the FROZEN snapshot copy, and `issue()` loads the profile server-side).
 * @ZodSerializerDto strips every response (spec §8).
 */
import { Body, Controller, Get, Put, UseGuards } from "@nestjs/common";

import { type LegalProfile, type LegalProfileResponse } from "@repo/validators/legal-profiles";

import { ZodSerializerDto } from "../../common/api/zod.js";
import { RequireRole } from "../../common/rbac/require-role.decorator.js";
import { CurrentScope } from "../../common/tenancy/current-scope.decorator.js";
import { type RequestScope } from "../../common/tenancy/request-scope.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { SessionGuard } from "../auth/session.guard.js";
import {
  LegalProfileDto,
  LegalProfileResponseDto,
  UpsertLegalProfileDto,
} from "./legal-profiles.dto.js";
import { LegalProfilesService } from "./legal-profiles.service.js";

@Controller("org/legal-profile")
@UseGuards(SessionGuard, RolesGuard)
@RequireRole("admin")
export class LegalProfilesController {
  constructor(private readonly legalProfiles: LegalProfilesService) {}

  /** The org's profile, or `{ profile: null }` when it has not been completed. */
  @Get()
  @ZodSerializerDto(LegalProfileResponseDto)
  async get(@CurrentScope() scope: RequestScope): Promise<LegalProfileResponse> {
    return { profile: await this.legalProfiles.get(scope) };
  }

  /** Create-or-replace the singleton profile (full-document, idempotent → no @Idempotent). */
  @Put()
  @ZodSerializerDto(LegalProfileDto)
  put(
    @CurrentScope() scope: RequestScope,
    @Body() body: UpsertLegalProfileDto,
  ): Promise<LegalProfile> {
    return this.legalProfiles.upsert(scope, body);
  }
}
