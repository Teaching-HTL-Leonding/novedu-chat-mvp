// The pure part of the one-off copy: WHAT is copied, and how a source row turns
// into INSERT parameters. No I/O, no driver imports — everything here is covered
// by `tables.test.mjs` (`node --test`).
//
// Column lists are EXPLICIT (never `SELECT *`) so schema drift fails loudly: a
// column that disappeared from the source makes the source SELECT error out, and
// a column the source has but this list does not is reported as a WARN by
// `copy.ts` before anything is written.

export type TableSpec = {
  /** Table name, identical on both sides. */
  readonly table: string;
  /** Every column that is copied, in the order used by SELECT and INSERT. */
  readonly columns: readonly string[];
};

/**
 * The 11 app-owned tables, in an order that reads top-down like the data model
 * (users → codes → the rows that reference a code → the standalone stores →
 * the usage aggregates). There are no foreign keys on either side, so the order
 * is documentation rather than a constraint — but it keeps the log readable and
 * makes a partial run easy to reason about.
 *
 * NOT copied, deliberately:
 *   - `mastra_*` / everything in schema `mastra` — conversations are not
 *     migrated; Mastra starts empty on Postgres.
 *   - `novedu_drizzle_migrations` — the target has its own fresh baseline row
 *     written by the app's migrator at boot.
 */
export const TABLES: readonly TableSpec[] = [
  { table: "novedu_users", columns: ["user_id", "display_name"] },
  {
    table: "novedu_codes",
    columns: [
      "code",
      "module",
      "created_by",
      "file_url",
      "valid_from",
      "valid_until",
      "note",
      "origin",
      "anonymous",
      "llm_provider",
      "llm_model",
      "llm_reasoning",
      "created_at",
    ],
  },
  { table: "novedu_user_chats", columns: ["thread_id", "code", "user_id", "created_at"] },
  { table: "novedu_recent_codes", columns: ["user_id", "code", "last_used"] },
  {
    table: "novedu_writing_submissions",
    columns: ["code", "user_id", "text", "text_updated_at"],
  },
  {
    table: "novedu_reports",
    columns: [
      "id",
      "kind",
      "code",
      "user_id",
      "reaction",
      "description",
      "created_at",
      "thread_id",
      "question_id",
      "question_text",
      "answer_text",
      "feedback_text",
      "verdict",
      "had_images",
      "resolved_at",
      "resolved_by",
    ],
  },
  { table: "novedu_coding_keys", columns: ["code", "user_id", "api_key", "created_at"] },
  {
    table: "novedu_files",
    columns: [
      "id",
      "name",
      "kind",
      "title",
      "description",
      "content",
      "created_by",
      "valid_from",
      "valid_until",
      "closed_by",
    ],
  },
  {
    table: "novedu_images",
    columns: [
      "id",
      "name",
      "blob_path",
      "mime_type",
      "byte_size",
      "credit",
      "created_by",
      "valid_from",
      "valid_until",
      "closed_by",
    ],
  },
  {
    table: "novedu_usage_by_code",
    columns: [
      "code",
      "hour",
      "module",
      "provider",
      "model",
      "input_tokens_new",
      "input_tokens_cached",
      "output_tokens",
      "tool_calls",
      "user_messages",
      "quiz_answers",
      "writing_saves",
    ],
  },
  {
    table: "novedu_usage_by_user",
    columns: [
      "user_id",
      "hour",
      "input_tokens_new",
      "input_tokens_cached",
      "output_tokens",
      "tool_calls",
      "user_messages",
      "quiz_answers",
      "writing_saves",
    ],
  },
];

/**
 * Postgres refuses more than 65535 bind parameters in one extended-protocol
 * statement. Stay well under it: 60000 leaves room and still batches the widest
 * table (16 columns) 500 rows at a time.
 */
export const PARAMETER_BUDGET = 60_000;

/** Rows per INSERT, never more than 500 and never over the parameter budget. */
export const MAX_BATCH_ROWS = 500;

/** Only lower-case snake_case identifiers exist on either side; anything else is a bug. */
const IDENTIFIER = /^[a-z][a-z0-9_]*$/;

export function assertIdentifier(name: string): string {
  if (!IDENTIFIER.test(name)) {
    throw new Error(`refusing to build SQL for a non-identifier: ${JSON.stringify(name)}`);
  }
  return name;
}

/** `[novedu_codes]` — T-SQL bracket quoting for the source side. */
export function quoteMssql(name: string): string {
  return `[${assertIdentifier(name)}]`;
}

/** `"novedu_codes"` — standard quoting for the Postgres side. */
export function quotePg(name: string): string {
  return `"${assertIdentifier(name)}"`;
}

export function batchSize(columnCount: number): number {
  if (!Number.isInteger(columnCount) || columnCount < 1) {
    throw new Error(`column count must be a positive integer, got ${columnCount}`);
  }
  return Math.max(1, Math.min(MAX_BATCH_ROWS, Math.floor(PARAMETER_BUDGET / columnCount)));
}

/** `SELECT [a], [b] FROM [dbo].[t]` — no `SELECT *`, so a dropped column errors. */
export function selectStatement(spec: TableSpec): string {
  const columns = spec.columns.map(quoteMssql).join(", ");
  return `SELECT ${columns} FROM [dbo].${quoteMssql(spec.table)}`;
}

export function countStatementMssql(spec: TableSpec): string {
  return `SELECT COUNT_BIG(*) AS n FROM [dbo].${quoteMssql(spec.table)}`;
}

export function countStatementPg(spec: TableSpec): string {
  return `select count(*)::text as n from public.${quotePg(spec.table)}`;
}

/**
 * `insert into "t" ("a","b") values ($1,$2),($3,$4)` — one multi-row statement
 * per batch, fully parameterised (no value ever reaches the SQL text).
 */
export function insertStatement(spec: TableSpec, rowCount: number): string {
  if (!Number.isInteger(rowCount) || rowCount < 1) {
    throw new Error(`row count must be a positive integer, got ${rowCount}`);
  }
  const columnCount = spec.columns.length;
  if (rowCount * columnCount > 65535) {
    throw new Error(
      `${spec.table}: ${rowCount} rows x ${columnCount} columns exceeds the 65535 parameter limit`,
    );
  }
  const columns = spec.columns.map(quotePg).join(", ");
  const tuples: string[] = [];
  for (let row = 0; row < rowCount; row++) {
    const placeholders: string[] = [];
    for (let column = 0; column < columnCount; column++) {
      placeholders.push(`$${row * columnCount + column + 1}`);
    }
    tuples.push(`(${placeholders.join(", ")})`);
  }
  return `insert into public.${quotePg(spec.table)} (${columns}) values ${tuples.join(", ")}`;
}

/**
 * The per-value mapping. node-mssql already hands back the shapes Postgres wants:
 *
 *   bit          -> boolean          -> pg boolean
 *   datetime2    -> JS Date (UTC)    -> pg timestamptz
 *   nvarchar/... -> string           -> pg varchar/text
 *   int          -> number           -> pg integer
 *   bigint       -> string (node-mssql's default for bigint, to keep precision)
 *                                    -> pg int8 accepts the decimal string as-is
 *
 * So the only real work is normalising absent values to SQL NULL. Anything that
 * is not one of the expected shapes is rejected rather than silently coerced —
 * this runs once, against production data, and a surprise is worth an abort.
 */
export function toParameterValue(value: unknown, context: string): unknown {
  if (value === undefined || value === null) return null;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return value;
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error(`${context}: invalid Date`);
    }
    return value;
  }
  throw new Error(`${context}: unexpected value type ${Object.prototype.toString.call(value)}`);
}

/** Flattens rows into the positional parameter array `insertStatement` expects. */
export function flattenRows(spec: TableSpec, rows: readonly Record<string, unknown>[]): unknown[] {
  const values: unknown[] = [];
  for (const [index, row] of rows.entries()) {
    for (const column of spec.columns) {
      if (!(column in row)) {
        throw new Error(`${spec.table} row ${index}: source row has no column "${column}"`);
      }
      values.push(toParameterValue(row[column], `${spec.table}.${column} (row ${index})`));
    }
  }
  return values;
}

/**
 * Compares our copy list against the columns the source table actually has.
 * `missing` would make the SELECT fail anyway (reported first, with a clear
 * message); `extra` is data this script would silently leave behind, so it is
 * WARNed about before any write.
 */
export function diffColumns(
  ours: readonly string[],
  source: readonly string[],
): { missing: string[]; extra: string[] } {
  const sourceSet = new Set(source);
  const oursSet = new Set(ours);
  return {
    missing: ours.filter((column) => !sourceSet.has(column)),
    extra: source.filter((column) => !oursSet.has(column)),
  };
}

/** Splits a row array into consecutive chunks of at most `size` rows. */
export function chunk<T>(rows: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) {
    throw new Error(`chunk size must be a positive integer, got ${size}`);
  }
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}
