import { sql } from "drizzle-orm";
import {
  bit,
  datetime2,
  index,
  mssqlTable,
  nvarchar,
  primaryKey,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mssql-core";

// NOTE: drizzle's mssql `nvarchar` accepts `{ length: "max" }`, which compiles to
// SQL Server's `NVARCHAR(MAX)` — used for the (potentially large) YAML body below.
// `NVARCHAR(MAX)` can NOT live in an index key, which is why `name` (the lookup
// key on the chat hot path) is a bounded, indexable `nvarchar(450)`.

// App-owned tables in the shared Azure SQL database. They live next to Mastra's
// auto-managed `mastra_*` tables, distinguished by the `novedu_` prefix.
//
// HARD RULE: NO foreign keys between `novedu_*` and `mastra_*` tables — Mastra
// owns its schema and may recreate/migrate it at any time; we never couple to it.
// The relationships are by-value instead:
//
//   novedu_codes.code = novedu_user_chats.code = mastra_threads.resourceId
//   novedu_user_chats.thread_id = mastra_threads.id = mastra_messages.thread_id
//
// so user → user-chat → chat-history joins work in plain SQL without FKs.

// One row per shareable code, across every module. `module` (`tutor` | `quiz` |
// future) is the dispatch discriminator: the student entry route and the runtime
// route read it off the row to pick the renderer/agent. `file_url` is the
// activity YAML the code hands out. The creating teacher is `created_by` (the
// session user id = Entra `oid`). The validity window is inclusive in both
// directions, stored as UTC datetime2. `origin` documents where the code was
// created (dev/prod host) and is NEVER used in lookups — a code created on
// localhost must work in production, since all environments share this database.
//
// `code` is sized generously (`varchar(32)`, `[a-z0-9-]`) so teacher-defined
// memorable codes fit later; today `generateCode()` mints `[a-z0-9]{10}`.
//
// `anonymous` is the activity YAML's privacy flag FROZEN at create time (the
// create action loads the YAML to validate it anyway). It governs the
// stats-display decision (per-student data) for the code's life. Editing the
// YAML later does NOT update this column — the value captured when the code was
// minted is the one that holds. (The runtime attribution path reads `anonymous`
// LIVE from the YAML instead — see lib/user-chat-store.ts.) Rows are kept until
// the teacher deletes the code (no garbage collection), so the activity at
// `/<code>` simply stops opening once the window closes (`checkCode`) while the
// code and its conversation data remain available for stats.
export const codes = mssqlTable(
  "novedu_codes",
  {
    code: varchar("code", { length: 32 }).primaryKey(),
    module: varchar("module", { length: 16 }).notNull(),
    createdBy: nvarchar("created_by", { length: 64 }).notNull(),
    fileUrl: nvarchar("file_url", { length: 2048 }).notNull(),
    validFrom: datetime2("valid_from").notNull(),
    validUntil: datetime2("valid_until").notNull(),
    note: nvarchar("note", { length: 200 }).notNull().default(""),
    origin: nvarchar("origin", { length: 256 }),
    // Default true = anonymous: the privacy-safe default, and what any row
    // predating this column should read as.
    anonymous: bit("anonymous").notNull().default(true),
    createdAt: datetime2("created_at").notNull(),
  },
  // The teacher's "Codes" page (and the stats pages) list by creator; the
  // module filter narrows by activity. No index on `valid_until`: nothing
  // deletes by expiry (deletion is explicit, teacher-initiated).
  (t) => [
    index("ix_novedu_codes_created_by").on(t.createdBy),
    index("ix_novedu_codes_module").on(t.module),
  ],
);

// Links a signed-in user to a chat (Mastra thread) opened under a code. Rows are
// written ONLY when the activity YAML opts out of anonymity (`anonymous: false`)
// — by default no user↔chat link is persisted. `code` is widened to match
// novedu_codes.code so a real code (any module) stores by value.
//
// No FK to novedu_codes either: these rows are deliberately kept even after a
// code is deleted, so chat-history attribution outlives the code.
export const userChats = mssqlTable(
  "novedu_user_chats",
  {
    threadId: varchar("thread_id", { length: 64 }).primaryKey(),
    code: varchar("code", { length: 32 }).notNull(),
    userId: nvarchar("user_id", { length: 64 }).notNull(),
    createdAt: datetime2("created_at").notNull(),
  },
  (t) => [
    // "All chats for a code" …
    index("ix_novedu_user_chats_code").on(t.code),
    // … and "all chats of a user".
    index("ix_novedu_user_chats_user_id").on(t.userId),
  ],
);

// A user's recently used codes, backing the shortcuts on the chat entry page
// (`/`). Pure convenience bookkeeping: the displayed label (the teacher's note)
// is NOT duplicated here — the entry page joins novedu_codes, so codes whose row
// was deleted silently drop out of the list. Kept separate from
// novedu_user_chats on purpose: that table is the privacy-gated user↔chat
// attribution, this one only says "this user opened this code".
export const recentCodes = mssqlTable(
  "novedu_recent_codes",
  {
    userId: nvarchar("user_id", { length: 64 }).notNull(),
    code: varchar("code", { length: 32 }).notNull(),
    lastUsed: datetime2("last_used").notNull(),
  },
  // The PK doubles as the per-user lookup index (user_id prefix).
  (t) => [primaryKey({ columns: [t.userId, t.code] })],
);

// App-hosted YAML files (tutor definitions and fragment libraries) that teachers
// author in-app instead of hosting on GitHub/S3/Azure Blob. The public GET
// endpoint (`/api/files/<name>`) serves the latest version as raw YAML, so such a
// URL drops straight into the existing tutor-code flow.
//
// TEMPORAL / append-only versioning: each row is ONE version of one file. The
// file's identity is its `name`; the ACTIVE version is the single row with
// `valid_until IS NULL`. Every other row is history (full content kept per
// version — never diffs). The transitions, all run in a transaction:
//
//   create: INSERT one active row.
//   update: close the active row (set valid_until + closed_by) and INSERT a new
//           active row — i.e. a soft-delete of the old version + a fresh version.
//   delete: close the active row (soft delete) and INSERT nothing.
//
// `created_by` is the oid of whoever wrote a version; `closed_by` is the oid of
// whoever ended it (the updater OR the deleter), so logical deletions are
// attributed too. The active row's `created_by` is therefore the file's "last
// writer". "At most one active row per name" is enforced at the DATABASE level
// by a FILTERED UNIQUE index (`name` WHERE `valid_until IS NULL`), so two
// concurrent creates of the same name cannot both succeed — the conditional
// `UPDATE … WHERE id=? AND valid_until IS NULL` in update/delete is the matching
// optimistic-concurrency guard. There are NO foreign keys (same rule as the
// other novedu_* tables).
export const files = mssqlTable(
  "novedu_files",
  {
    // Surrogate id, unique PER VERSION (a fresh uuid for every row).
    id: varchar("id", { length: 36 }).primaryKey(),
    // Public identifier / GET-URL key. Bounded so it can be indexed (see note
    // above). Allows letters/digits/underscore/hyphen today; `/`-separated
    // folder paths are a future extension (hence the generous length).
    name: nvarchar("name", { length: 450 }).notNull(),
    // "tutor" | "fragment" | "quiz" — chosen at create time, picks the validator.
    kind: varchar("kind", { length: 16 }).notNull(),
    // Denormalized from the validated YAML (tutor only; null for fragments/quiz) so
    // the file list can be searched by title/description without parsing every body.
    title: nvarchar("title", { length: 512 }),
    description: nvarchar("description", { length: 2048 }),
    // The ENTIRE YAML for this version (NVARCHAR(MAX)).
    content: nvarchar("content", { length: "max" }).notNull(),
    // oid of the writer who created this version.
    createdBy: nvarchar("created_by", { length: 64 }).notNull(),
    // When this version became active.
    validFrom: datetime2("valid_from").notNull(),
    // When this version was closed; NULL = currently active.
    validUntil: datetime2("valid_until"),
    // oid of whoever set valid_until (updater or deleter); NULL while active.
    closedBy: nvarchar("closed_by", { length: 64 }),
  },
  (t) => [
    // At most ONE active version per name — a SQL Server filtered unique index.
    // This both enforces the invariant (closing the create-time race) and serves
    // the GET/edit/close hot path, whose lookup is exactly `name WHERE
    // valid_until IS NULL`.
    uniqueIndex("ux_novedu_files_active_name").on(t.name).where(sql`${t.validUntil} IS NULL`),
    // "all active files" for the list page (active rows are the minority as
    // history accumulates, so an index on the discriminator pays off).
    index("ix_novedu_files_valid_until").on(t.validUntil),
  ],
);
