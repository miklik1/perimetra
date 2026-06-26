/**
 * Customer (odběratel) contracts (ADR 0082) — the api↔frontend seam for the
 * buyer entity. Field rules live here; the api derives nestjs-zod DTOs and the
 * web reuses them for forms. Identifying fields map to `pii()` columns
 * (ADR 0040/0071) on the DB side.
 */
import { z } from "zod";

import { cursorQuerySchema, paginated } from "./api/pagination";
import { isoDatetime } from "./primitives";
import { dic, ico } from "./primitives/cz";

export const CUSTOMER_STATUSES = ["active", "archived"] as const;
export const customerStatusSchema = z.enum(CUSTOMER_STATUSES);
export type CustomerStatus = z.infer<typeof customerStatusSchema>;

/** Response shape — every customer endpoint serializes through this (strip semantics). */
export const customerSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(200),
  ico: z.string().nullable(),
  dic: z.string().nullable(),
  vatPayer: z.boolean(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  addressLine: z.string().nullable(),
  city: z.string().nullable(),
  postalCode: z.string().nullable(),
  country: z.string(),
  note: z.string().nullable(),
  status: customerStatusSchema,
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
});
export type Customer = z.infer<typeof customerSchema>;

export const createCustomerSchema = z.object({
  name: z.string().min(1).max(200),
  ico: ico.nullable().optional(),
  dic: dic.nullable().optional(),
  vatPayer: z.boolean().optional(),
  email: z.email().max(320).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  addressLine: z.string().max(200).nullable().optional(),
  city: z.string().max(120).nullable().optional(),
  postalCode: z.string().max(20).nullable().optional(),
  country: z.string().length(2).optional(),
  note: z.string().max(2000).nullable().optional(),
});
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

export const updateCustomerSchema = createCustomerSchema.partial().extend({
  status: customerStatusSchema.optional(),
});
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

/** Keyset pagination (spec §8) — cursor is a customer id (UUIDv7, time-ordered). */
export const listCustomersQuerySchema = cursorQuerySchema.extend({
  status: customerStatusSchema.optional(),
});
export type ListCustomersQuery = z.infer<typeof listCustomersQuerySchema>;

export const customersPageSchema = paginated(customerSchema);
export type CustomersPage = z.infer<typeof customersPageSchema>;
