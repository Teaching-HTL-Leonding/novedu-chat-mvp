import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// better-auth's own tables, in the app's `novedu_` naming and the `public`
// schema — a HAND-MAINTAINED mirror of better-auth's schema. To check it after
// bumping better-auth, regenerate into a temp file
// (`npx auth@<version> generate --config auth.ts --output /tmp/gen.ts --yes`)
// and diff: the generator's output is not usable verbatim here (it emits
// `timestamp` WITHOUT time zone, makes `is_teacher` nullable and imports
// `relations`, which drizzle-orm no longer exports), so the differences are
// resolved by hand into the conventions below.
//
// Two contracts constrain this file:
//
//  1. The JS keys are better-auth's FIELD NAMES (camelCase: `emailVerified`,
//     `idToken`, `accessTokenExpiresAt`, …). The drizzle adapter addresses every
//     column by key, so renaming a key breaks the adapter at runtime. Only the
//     `"…"` column names are ours (snake_case, like every other novedu table).
//  2. `authSchema` below is keyed by better-auth's MODEL NAMES — the adapter
//     looks each table up as `schema[modelName]`, and every model is renamed to
//     its `novedu_*` name in `auth.ts` (`user.modelName`, `session.modelName`, …;
//     the device-code table via the plugin's `schema` option).
//
// Timestamps follow the repo convention (`timestamptz`, always UTC). NOTE that
// `updated_at` on session/account has NO database default (better-auth always
// supplies it), so any hand-written INSERT — the seed migration, the e2e session
// minting — must set it explicitly.
//
// Foreign keys: `novedu_session.user_id` and `novedu_account.user_id` reference
// `novedu_user.id` with ON DELETE CASCADE. These are the ONLY FKs in the
// `novedu_*` space — `novedu_device_code.user_id` deliberately has none (it holds
// a claim that outlives nothing), and the "no FK between novedu_* and mastra_*"
// rule is untouched.

// One row per signed-in person. `id` is better-auth's own random id for anyone
// who signs in from now on; rows that predate this table carry the Entra `oid`
// as their id (that is what every `user_id`/`created_by` column across the
// novedu_* tables stores by value), and the oid is kept in
// `novedu_account.account_id` either way.
//
// `name` is the display name shown wherever a user id would otherwise be — it is
// overwritten from the Entra profile on every sign-in, and the LEFT JOINs that
// resolve an id to a name fall back to the raw id when no row exists.
//
// `is_teacher` is the app's own field (better-auth `additionalFields`), owned by
// the SERVER: it is recomputed from the ID token's `groups` claim on every
// sign-in and can never be set through the API (`input: false`).
export const authUsers = pgTable("novedu_user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  isTeacher: boolean("is_teacher").default(false).notNull(),
});

// One row per live session — the app has NO cookie cache, so every request
// resolves its session with one indexed lookup on `token` (hence the unique
// index, which doubles as that lookup's index). Both channels share this table:
// the browser sends the token in a signed cookie, the CLI as a bearer.
export const authSessions = pgTable(
  "novedu_session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    // No database default on purpose (better-auth always writes it).
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
  },
  // "all sessions of a user" — the sign-out-everywhere / cascade path.
  (t) => [index("novedu_session_userId_idx").on(t.userId)],
);

// The link to the identity provider: one row per `(provider_id, account_id)`.
// `account_id` holds the Entra `oid`, which is what makes a pre-existing
// oid-keyed user row link to the right identity on its first better-auth
// sign-in. `id_token` is what the teacher-flag hook reads the `groups` claim
// from; the token columns are never returned by the API.
export const authAccounts = pgTable(
  "novedu_account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    // No database default on purpose (better-auth always writes it).
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => [index("novedu_account_userId_idx").on(t.userId)],
);

// better-auth's short-lived verification values (the OAuth state during a
// sign-in round trip). Rows are transient — written at the start of a flow and
// consumed at its end.
export const authVerifications = pgTable(
  "novedu_verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
  },
  (t) => [index("novedu_verification_identifier_idx").on(t.identifier)],
);

// The device-authorization plugin's table — one row per CLI sign-in attempt.
// `device_code` is the secret the CLI polls with, `user_code` the short string
// the person approves in the browser; both are looked up directly, hence the two
// unique indexes. `user_id` is filled by the claim step and carries NO foreign
// key (the row is deleted on redemption/denial and never joined for display).
export const deviceCodes = pgTable(
  "novedu_device_code",
  {
    id: text("id").primaryKey(),
    deviceCode: text("device_code").notNull(),
    userCode: text("user_code").notNull(),
    userId: text("user_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    status: text("status").notNull(),
    lastPolledAt: timestamp("last_polled_at", { withTimezone: true, mode: "date" }),
    pollingInterval: integer("polling_interval"),
    clientId: text("client_id"),
    scope: text("scope"),
  },
  (t) => [
    uniqueIndex("novedu_device_code_deviceCode_uidx").on(t.deviceCode),
    uniqueIndex("novedu_device_code_userCode_uidx").on(t.userCode),
  ],
);

// What `drizzleAdapter(db, { provider: "pg", schema: authSchema })` receives:
// keyed by MODEL NAME, because the adapter resolves each table as
// `schema[modelName]` (see the header note).
export const authSchema = {
  novedu_user: authUsers,
  novedu_session: authSessions,
  novedu_account: authAccounts,
  novedu_verification: authVerifications,
  novedu_device_code: deviceCodes,
};
