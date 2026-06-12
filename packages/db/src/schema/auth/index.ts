/**
 * Better Auth tables (ADR 0033) — mirrors the `auth@1.6.16 generate` output
 * for core + email/password + admin() + organization(), adjusted to repo
 * conventions where they don't conflict:
 *
 * - `timestamps()` (timestamptz) instead of the CLI's naive timestamps — the
 *   adapter passes `Date`s, so the column type is ours to choose (ADR 0032).
 * - ids stay `text`, NOT the `id()` uuidv7 helper: Better Auth generates ids
 *   app-side (32-char alphanumeric) and the adapter inserts them verbatim — a
 *   `uuid` column would reject them. Deliberate exception to ADR 0032.
 * - Better Auth's model/column names are load-bearing (the Drizzle adapter
 *   looks tables up by export name and fields by key) — do not rename.
 *
 * The organization/member/invitation tables are the dormant tenancy seam:
 * generated now so the retrofit is a config change, not a migration project.
 */
import { boolean, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { timestamps } from "../../columns.js";
import { pii } from "../../pii.js";

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: pii("user.name", text("name").notNull()),
  email: pii("user.email", text("email").notNull().unique()),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: pii("user.image", text("image")),
  /**
   * BCP 47 language tag driving locale-aware transactional email (spec §7.4).
   * A preference, not identity data — deliberately NOT `pii()`-wrapped.
   * Registered with Better Auth via `user.additionalFields` (auth.instance.ts).
   */
  locale: text("locale"),
  // admin plugin
  role: text("role"),
  banned: boolean("banned").default(false),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires", { withTimezone: true }),
  ...timestamps(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: pii("session.ip_address", text("ip_address")),
    userAgent: pii("session.user_agent", text("user_agent")),
    // admin plugin
    impersonatedBy: text("impersonated_by"),
    // organization plugin
    activeOrganizationId: text("active_organization_id"),
    ...timestamps(),
  },
  (t) => [index("session_userId_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    /** "credential" rows carry the hashed password in `password`. */
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    ...timestamps(),
  },
  (t) => [index("account_userId_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    // identifier embeds the target email (e.g. "reset-password:<email>")
    identifier: pii("verification.identifier", text("identifier").notNull()),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

export const organization = pgTable(
  "organization",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    logo: text("logo"),
    metadata: text("metadata"),
    ...timestamps(),
  },
  (t) => [uniqueIndex("organization_slug_uidx").on(t.slug)],
);

export const member = pgTable(
  "member",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    ...timestamps(),
  },
  (t) => [
    index("member_organizationId_idx").on(t.organizationId),
    index("member_userId_idx").on(t.userId),
  ],
);

export const invitation = pgTable(
  "invitation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    email: pii("invitation.email", text("email").notNull()),
    role: text("role"),
    status: text("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    ...timestamps(),
  },
  (t) => [
    index("invitation_organizationId_idx").on(t.organizationId),
    index("invitation_email_idx").on(t.email),
  ],
);
