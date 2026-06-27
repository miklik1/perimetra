/**
 * Legal-profiles service (ADR 0088) — the org's singleton legal identity.
 * `get` returns null for a not-yet-completed profile (an honest empty state, not
 * a 404 — the org simply hasn't filled it in). `upsert` is `@Transactional()`
 * (the write + audit row commit together); no outbox (config data, no fan-out).
 *
 * `get` is also the cross-module read the quotes module calls at issue to FREEZE
 * the supplier block into the immutable snapshot (a service call, never a schema
 * join — CLAUDE.md). A null there is the `legal_profile_required` 422.
 */
import { Transactional } from "@nestjs-cls/transactional";
import { Injectable } from "@nestjs/common";

import { type LegalProfileRow } from "@repo/db/schema/legal-profiles";
import { type LegalProfile, type UpsertLegalProfileInput } from "@repo/validators/legal-profiles";

import { type RequestScope } from "../../common/tenancy/request-scope.js";
import { AuditService } from "../audit/audit.service.js";
import {
  LegalProfilesRepository,
  type UpsertLegalProfileData,
} from "./legal-profiles.repository.js";

/** The mutable surface the audit diff tracks. */
const AUDITED_FIELDS = [
  "name",
  "ico",
  "dic",
  "vatPayer",
  "addressLine",
  "city",
  "postalCode",
  "country",
  "bankAccount",
  "registrationNote",
] as const;

function toLegalProfile(row: LegalProfileRow): LegalProfile {
  return {
    id: row.id,
    name: row.name,
    ico: row.ico,
    dic: row.dic,
    vatPayer: row.vatPayer,
    addressLine: row.addressLine,
    city: row.city,
    postalCode: row.postalCode,
    country: row.country,
    bankAccount: row.bankAccount,
    registrationNote: row.registrationNote,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Normalize the partial PUT body into the full column set (every field present). */
function upsertData(input: UpsertLegalProfileInput): UpsertLegalProfileData {
  return {
    name: input.name,
    ico: input.ico ?? null,
    dic: input.dic ?? null,
    vatPayer: input.vatPayer ?? false,
    addressLine: input.addressLine ?? null,
    city: input.city ?? null,
    postalCode: input.postalCode ?? null,
    country: input.country ?? "CZ",
    bankAccount: input.bankAccount ?? null,
    registrationNote: input.registrationNote ?? null,
  };
}

function auditDiff(before: LegalProfileRow | null, after: LegalProfileRow) {
  const diff = { before: {} as Record<string, unknown>, after: {} as Record<string, unknown> };
  for (const field of AUDITED_FIELDS) {
    if (!before || before[field] !== after[field]) {
      diff.before[field] = before ? before[field] : null;
      diff.after[field] = after[field];
    }
  }
  return diff;
}

@Injectable()
export class LegalProfilesService {
  constructor(
    private readonly legalProfiles: LegalProfilesRepository,
    private readonly audit: AuditService,
  ) {}

  /** The org's legal profile, or null when it has not been completed yet. */
  async get(scope: RequestScope): Promise<LegalProfile | null> {
    const row = await this.legalProfiles.find(scope);
    return row ? toLegalProfile(row) : null;
  }

  /** Create-or-replace the org's singleton profile (idempotent PUT). */
  @Transactional()
  async upsert(scope: RequestScope, input: UpsertLegalProfileInput): Promise<LegalProfile> {
    const before = await this.legalProfiles.find(scope);
    const row = await this.legalProfiles.upsert(scope, upsertData(input));
    await this.audit.record({
      actorId: scope.userId,
      action: before ? "legal-profile.update" : "legal-profile.create",
      entityType: "legal-profile",
      entityId: row.id,
      diff: auditDiff(before, row),
    });
    return toLegalProfile(row);
  }
}
