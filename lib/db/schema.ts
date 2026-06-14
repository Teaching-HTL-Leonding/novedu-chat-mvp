import {
  bit,
  datetime2,
  index,
  mssqlTable,
  nvarchar,
  primaryKey,
  varchar,
} from "drizzle-orm/mssql-core";

// App-owned tables in the shared Azure SQL database. They live next to Mastra's
// auto-managed `mastra_*` tables, distinguished by the `novedu_` prefix.
//
// HARD RULE: NO foreign keys between `novedu_*` and `mastra_*` tables — Mastra
// owns its schema and may recreate/migrate it at any time; we never couple to it.
// The relationships are by-value instead:
//
//   novedu_tutor_codes.code = novedu_user_chats.code = mastra_threads.resourceId
//   novedu_user_chats.thread_id = mastra_threads.id = mastra_messages.thread_id
//
// so user → user-chat → chat-history joins work in plain SQL without FKs.

// One row per shared tutor code. The creating teacher is `created_by` (the
// session user id = Entra `oid`). The validity window is half-open in neither direction:
// both bounds are inclusive, stored as UTC datetime2. `origin` documents where
// the code was created (dev/prod host) and is NEVER used in lookups — a code
// created on localhost must work in production, since all environments share
// this database.
//
// `anonymous` is the tutor YAML's privacy flag FROZEN at create time (the
// create action loads the YAML to validate it anyway). It governs whether
// chats record who owns them in `novedu_user_chats` and whether the stats page
// shows per-student data. Editing the YAML later does NOT update this column —
// the value captured when the code was minted is the one that holds. Rows are
// kept until the teacher deletes the code (no garbage collection), so the chat
// at `/<code>` simply stops opening once the window closes (`checkTutorCode`)
// while the code and its conversation data remain available for stats.
export const tutorCodes = mssqlTable(
  "novedu_tutor_codes",
  {
    code: varchar("code", { length: 10 }).primaryKey(),
    createdBy: nvarchar("created_by", { length: 64 }).notNull(),
    tutorUrl: nvarchar("tutor_url", { length: 2048 }).notNull(),
    validFrom: datetime2("valid_from").notNull(),
    validUntil: datetime2("valid_until").notNull(),
    note: nvarchar("note", { length: 200 }).notNull().default(""),
    origin: nvarchar("origin", { length: 256 }),
    // Default true = anonymous: the privacy-safe default, and what any row
    // predating this column should read as.
    anonymous: bit("anonymous").notNull().default(true),
    createdAt: datetime2("created_at").notNull(),
  },
  // The teacher's "Shared Tutor Codes" page (and the stats pages) list by
  // creator. There is no longer an index on `valid_until`: nothing deletes by
  // expiry anymore (garbage collection was removed in favor of explicit
  // teacher-initiated deletion).
  (t) => [index("ix_novedu_tutor_codes_created_by").on(t.createdBy)],
);

// Links a signed-in user to a chat (Mastra thread) opened under a tutor code.
// Rows are written ONLY when the tutor YAML opts out of anonymity
// (`anonymous: false`) — by default no user↔chat link is persisted.
//
// No FK to novedu_tutor_codes either: expired codes are garbage-collected
// while these rows are deliberately kept, so chat-history attribution
// outlives the code.
export const userChats = mssqlTable(
  "novedu_user_chats",
  {
    threadId: varchar("thread_id", { length: 64 }).primaryKey(),
    code: varchar("code", { length: 10 }).notNull(),
    userId: nvarchar("user_id", { length: 64 }).notNull(),
    createdAt: datetime2("created_at").notNull(),
  },
  (t) => [
    // "All chats for a tutor code" …
    index("ix_novedu_user_chats_code").on(t.code),
    // … and "all chats of a user".
    index("ix_novedu_user_chats_user_id").on(t.userId),
  ],
);

// A user's recently used tutor codes, backing the shortcuts on the chat entry
// page (`/`). Pure convenience bookkeeping: the displayed label (the teacher's
// note) is NOT duplicated here — the entry page joins novedu_tutor_codes, so
// codes whose row was garbage-collected silently drop out of the list. Kept
// separate from novedu_user_chats on purpose: that table is the privacy-gated
// user↔chat attribution, this one only says "this user opened this code".
export const recentCodes = mssqlTable(
  "novedu_recent_codes",
  {
    userId: nvarchar("user_id", { length: 64 }).notNull(),
    code: varchar("code", { length: 10 }).notNull(),
    lastUsed: datetime2("last_used").notNull(),
  },
  // The PK doubles as the per-user lookup index (user_id prefix).
  (t) => [primaryKey({ columns: [t.userId, t.code] })],
);
