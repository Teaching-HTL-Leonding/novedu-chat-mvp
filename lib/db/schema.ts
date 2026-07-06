import { sql } from "drizzle-orm";
import {
  bigint,
  bit,
  datetime2,
  index,
  int,
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
// directions, stored as UTC datetime2; each bound is OPTIONAL — a null
// `valid_from` opens the code immediately, a null `valid_until` never expires it
// (both null = always valid). `origin` documents where the code was
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
//
// `llm_provider`/`llm_model` are the code's OPTIONAL per-code LLM override: when
// set, they replace the activity YAML's `llm.provider`/`llm.model` for every
// request served under this code (docs/ai-models.md). BOTH-OR-NOTHING: either
// both are NULL (the YAML's `llm:` block applies) or both are set — model ids
// are provider-specific, so a lone half is meaningless and validation rejects
// it. Editable on /codes/edit (unlike the frozen `anonymous`/`file_url`). Sized
// like the usage tables' provider/model columns.
export const codes = mssqlTable(
  "novedu_codes",
  {
    code: varchar("code", { length: 32 }).primaryKey(),
    module: varchar("module", { length: 16 }).notNull(),
    createdBy: nvarchar("created_by", { length: 64 }).notNull(),
    fileUrl: nvarchar("file_url", { length: 2048 }).notNull(),
    validFrom: datetime2("valid_from"),
    validUntil: datetime2("valid_until"),
    note: nvarchar("note", { length: 200 }).notNull().default(""),
    origin: nvarchar("origin", { length: 256 }),
    // Default true = anonymous: the privacy-safe default, and what any row
    // predating this column should read as.
    anonymous: bit("anonymous").notNull().default(true),
    // Per-code LLM override pair (see the block comment above): NULL = no
    // override. Set/cleared together, never singly.
    llmProvider: varchar("llm_provider", { length: 32 }),
    llmModel: nvarchar("llm_model", { length: 256 }),
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

// One row per signed-in user: the Entra `oid` mapped to the display name the app
// shows in its nav bar (the Entra `name` claim). Upserted on every interactive
// sign-in (lib/user-name-store.ts, called from the auth `jwt` callback), so the
// stored name tracks the user's current Entra display name. Its sole purpose is to
// resolve the otherwise-opaque `oid` to a human name wherever a student id is shown
// to a teacher — the writing savers list, the student text page, and the
// conversation-stats table each LEFT-JOIN this table BY VALUE and fall back to the
// raw oid when no row exists yet (a user who has not signed in since this table was
// introduced). No history (the upsert overwrites), never garbage-collected, and no
// foreign keys (same rule as the other novedu_* tables).
export const users = mssqlTable("novedu_users", {
  // The Entra `oid` — the same stable user key stored as `user_id` in the tables
  // above. PK doubles as the lookup index for the joins.
  userId: nvarchar("user_id", { length: 64 }).primaryKey(),
  // The Entra `name` claim. Never blank: the upsert skips an empty name, so an
  // absent name leaves no row and the oid is shown as the fallback instead.
  displayName: nvarchar("display_name", { length: 256 }).notNull(),
});

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

// One saved text per `(code, student)` for the writing module — upserted on save
// (single active version, NO history). The student's saved Markdown plus the last
// save time. Rows exist only for non-anonymous writing codes (anonymous writing
// disables saving); the teacher review reads them back. `code` is widened to match
// novedu_codes.code so a real writing code stores by value; `user_id` is the
// student's Entra `oid`.
//
// No foreign keys (same rule as the other novedu_* tables): no FK to novedu_codes,
// so saved texts outlive a deleted code unless the code-delete path drops them
// explicitly.
export const writingSubmissions = mssqlTable(
  "novedu_writing_submissions",
  {
    code: varchar("code", { length: 32 }).notNull(),
    userId: nvarchar("user_id", { length: 64 }).notNull(),
    text: nvarchar("text", { length: "max" }).notNull().default(""),
    textUpdatedAt: datetime2("text_updated_at").notNull(),
  },
  // The PK enforces "one saved text per student per code" and doubles as the
  // per-code lookup index (code prefix) for the teacher review.
  (t) => [primaryKey({ columns: [t.code, t.userId] })],
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

// App-hosted images that teachers upload for use in activity content. The bytes
// live in Azure Blob Storage (one blob per row, addressed by `blob_path`); this
// table only tracks metadata. Retrieval is direct-to-blob via a read-SAS — there
// is no app route serving the bytes — and the blob is uploaded with a write-SAS
// before any row exists (the row is written only on confirm).
//
// TEMPORAL / append-only versioning, mirroring novedu_files: each row is ONE
// version of one image. The image's identity is its `name`; the ACTIVE version is
// the single row with `valid_until IS NULL`, every other row is history.
// `created_by` is the oid of whoever wrote a version; `closed_by` is the oid of
// whoever ended it. "At most one active row per name" is enforced at the DATABASE
// level by a FILTERED UNIQUE index (`name` WHERE `valid_until IS NULL`). There
// are NO foreign keys (same rule as the other novedu_* tables).
export const images = mssqlTable(
  "novedu_images",
  {
    // Surrogate id, unique PER VERSION (a fresh uuid for every row).
    id: varchar("id", { length: 36 }).primaryKey(),
    // Public identifier the teacher picks. Bounded so it can be indexed.
    name: nvarchar("name", { length: 450 }).notNull(),
    // Server-chosen blob name within the container: `<uuid>.<ext>`.
    blobPath: varchar("blob_path", { length: 80 }).notNull(),
    // "image/png" | "image/jpeg" | "image/svg+xml".
    mimeType: varchar("mime_type", { length: 32 }).notNull(),
    // Size of the uploaded blob in bytes.
    byteSize: int("byte_size").notNull(),
    // Optional attribution / "Content Credentials" (e.g. a CC BY notice) shown
    // below the image wherever it is rendered. NULL when the teacher gave none.
    credit: nvarchar("credit", { length: 512 }),
    // oid of the writer who created this version.
    createdBy: nvarchar("created_by", { length: 64 }).notNull(),
    // When this version became active.
    validFrom: datetime2("valid_from").notNull(),
    // When this version was closed; NULL = currently active.
    validUntil: datetime2("valid_until"),
    // oid of whoever set valid_until; NULL while active.
    closedBy: nvarchar("closed_by", { length: 64 }),
  },
  (t) => [
    // At most ONE active version per name — a SQL Server filtered unique index.
    uniqueIndex("ux_novedu_images_active_name").on(t.name).where(sql`${t.validUntil} IS NULL`),
    // "all active images" for the list page.
    index("ix_novedu_images_valid_until").on(t.validUntil),
  ],
);

// Usage metering — TWO INDEPENDENT hourly aggregate tables, deliberately NOT a
// (code × user) cross. `usage_by_code` has no user; `usage_by_user` has no code (and
// no module), so metering never recreates the user↔code link the anonymity
// invariant forbids for an anonymous code (docs/codes.md). The runtime knows the
// oid even for anonymous codes, but here it is only ever stored against an hour
// bucket, never alongside the code. Written OFF the response path by
// lib/usage-store.ts via an increment-UPSERT; read via SQL / Log Analytics (there
// is no in-app read surface this iteration). No foreign keys (same rule as the
// other novedu_* tables); never garbage-collected.
//
// `hour` is the UTC top-of-hour bucket. Token sums are `bigint` (they can grow
// large across a busy hour); the discrete counts are `int`. `input_tokens_cached`
// counts prefix-cache hits (SCCH's `prompt_tokens_details.cached_tokens`; see
// docs/usage-metering.md); `output_tokens` already includes reasoning tokens.
export const usageByCode = mssqlTable(
  "novedu_usage_by_code",
  {
    code: varchar("code", { length: 32 }).notNull(),
    hour: datetime2("hour").notNull(),
    // Denormalized from novedu_codes so admin can group by module without a join.
    module: varchar("module", { length: 16 }).notNull(),
    // Denormalized from the activity YAML (docs/usage-metering.md): which LLM
    // provider + model consumed the bucket's tokens. Nullable — only the LLM
    // recorder knows them; a counter recorder that creates the bucket first leaves
    // them NULL and recordLlmUsage COALESCE-fills on its increment. `model` is the
    // raw id (SCCH ids and Foundry deployment names are disjoint). NULL model on
    // pre-metering rows means "unknown".
    provider: varchar("provider", { length: 32 }),
    model: nvarchar("model", { length: 256 }),
    inputTokensNew: bigint("input_tokens_new", { mode: "number" }).notNull().default(0),
    inputTokensCached: bigint("input_tokens_cached", { mode: "number" }).notNull().default(0),
    outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
    toolCalls: int("tool_calls").notNull().default(0),
    userMessages: int("user_messages").notNull().default(0),
    quizAnswers: int("quiz_answers").notNull().default(0),
    writingSaves: int("writing_saves").notNull().default(0),
  },
  (t) => [
    // Per-code cost-over-time is the PK's natural read; the extra index serves the
    // admin time-range scan across ALL codes ("cost this week").
    primaryKey({ columns: [t.code, t.hour] }),
    index("ix_novedu_usage_by_code_hour").on(t.hour),
  ],
);

// Per-user hourly usage — the substrate a future per-student quota will `SUM` over a
// rolling window. NO `code` and NO `module`: this table must never reveal WHICH
// activity a student did, only how much they used in an hour. `user_id` is the
// student's Entra `oid`.
export const usageByUser = mssqlTable(
  "novedu_usage_by_user",
  {
    userId: nvarchar("user_id", { length: 64 }).notNull(),
    hour: datetime2("hour").notNull(),
    inputTokensNew: bigint("input_tokens_new", { mode: "number" }).notNull().default(0),
    inputTokensCached: bigint("input_tokens_cached", { mode: "number" }).notNull().default(0),
    outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
    toolCalls: int("tool_calls").notNull().default(0),
    userMessages: int("user_messages").notNull().default(0),
    quizAnswers: int("quiz_answers").notNull().default(0),
    writingSaves: int("writing_saves").notNull().default(0),
  },
  // The PK `(user_id, hour)` doubles as the per-user quota-window range-scan index.
  (t) => [primaryKey({ columns: [t.userId, t.hour] })],
);
