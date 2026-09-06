// Unit tests for the pure part of the copy tool. No database, no network:
//   node --test
// (Node strips the types off `tables.ts` on import; the file is erasable-syntax only.)

import assert from "node:assert/strict";
import test from "node:test";
import {
  assertIdentifier,
  batchSize,
  chunk,
  countStatementMssql,
  countStatementPg,
  diffColumns,
  flattenRows,
  insertStatement,
  MAX_BATCH_ROWS,
  quoteMssql,
  quotePg,
  selectStatement,
  TABLES,
  toParameterValue,
} from "./tables.ts";

test("the table list covers exactly the 11 app-owned tables, in the documented order", () => {
  assert.deepEqual(
    TABLES.map((spec) => spec.table),
    [
      "novedu_users",
      "novedu_codes",
      "novedu_user_chats",
      "novedu_recent_codes",
      "novedu_writing_submissions",
      "novedu_reports",
      "novedu_coding_keys",
      "novedu_files",
      "novedu_images",
      "novedu_usage_by_code",
      "novedu_usage_by_user",
    ],
  );
});

test("no mastra table and no migration bookkeeping is copied", () => {
  for (const spec of TABLES) {
    assert.ok(spec.table.startsWith("novedu_"), `${spec.table} is not an app table`);
    assert.notEqual(spec.table, "novedu_drizzle_migrations");
    assert.ok(!spec.table.startsWith("mastra"), `${spec.table} is a Mastra table`);
  }
});

test("every table has a non-empty, duplicate-free, identifier-shaped column list", () => {
  for (const spec of TABLES) {
    assert.ok(spec.columns.length > 0, `${spec.table} has no columns`);
    assert.equal(
      new Set(spec.columns).size,
      spec.columns.length,
      `${spec.table} lists a column twice`,
    );
    for (const column of spec.columns) assertIdentifier(column);
  }
});

test("a few known column lists match lib/db/schema.ts", () => {
  const byName = new Map(TABLES.map((spec) => [spec.table, spec.columns]));
  assert.deepEqual(byName.get("novedu_users"), ["user_id", "display_name"]);
  assert.deepEqual(byName.get("novedu_recent_codes"), ["user_id", "code", "last_used"]);
  assert.deepEqual(byName.get("novedu_coding_keys"), ["code", "user_id", "api_key", "created_at"]);
  // The widest table — the one that bounds the batch size.
  assert.equal(byName.get("novedu_reports")?.length, 16);
});

test("assertIdentifier rejects anything that could carry SQL", () => {
  assert.equal(assertIdentifier("novedu_codes"), "novedu_codes");
  for (const bad of ['a"b', "a]b", "a b", "A", "1a", "", "a;drop table x", "a-b"]) {
    assert.throws(() => assertIdentifier(bad), /non-identifier/);
  }
});

test("quoting uses the dialect's own form", () => {
  assert.equal(quoteMssql("novedu_files"), "[novedu_files]");
  assert.equal(quotePg("novedu_files"), '"novedu_files"');
});

test("batchSize caps at 500 and stays inside the parameter budget", () => {
  assert.equal(batchSize(2), MAX_BATCH_ROWS);
  assert.equal(batchSize(16), MAX_BATCH_ROWS);
  // A hypothetical very wide table drops below the cap rather than overflowing.
  assert.equal(batchSize(200), 300);
  assert.equal(batchSize(70_000), 1);
  for (const spec of TABLES) {
    assert.ok(batchSize(spec.columns.length) * spec.columns.length <= 65535);
  }
  assert.throws(() => batchSize(0), /positive integer/);
});

test("selectStatement names every column explicitly", () => {
  const spec = { table: "novedu_users", columns: ["user_id", "display_name"] };
  assert.equal(
    selectStatement(spec),
    "SELECT [user_id], [display_name] FROM [dbo].[novedu_users]",
  );
  for (const table of TABLES) assert.ok(!selectStatement(table).includes("*"));
});

test("count statements are per-dialect and read as text/bigint-safe", () => {
  const spec = TABLES[0];
  assert.equal(countStatementMssql(spec), "SELECT COUNT_BIG(*) AS n FROM [dbo].[novedu_users]");
  assert.equal(countStatementPg(spec), 'select count(*)::text as n from public."novedu_users"');
});

test("insertStatement numbers placeholders row-major", () => {
  const spec = { table: "novedu_users", columns: ["user_id", "display_name"] };
  assert.equal(
    insertStatement(spec, 2),
    'insert into public."novedu_users" ("user_id", "display_name") values ($1, $2), ($3, $4)',
  );
  assert.match(insertStatement(spec, 1), /values \(\$1, \$2\)$/);
});

test("insertStatement refuses to exceed the hard parameter limit", () => {
  const spec = { table: "novedu_users", columns: ["user_id", "display_name"] };
  assert.throws(() => insertStatement(spec, 40_000), /65535 parameter limit/);
  assert.throws(() => insertStatement(spec, 0), /positive integer/);
});

test("every table's largest real batch produces a valid placeholder count", () => {
  for (const spec of TABLES) {
    const rows = batchSize(spec.columns.length);
    const statement = insertStatement(spec, rows);
    const last = `$${rows * spec.columns.length}`;
    assert.ok(statement.endsWith(`${last})`), `${spec.table}: unexpected tail`);
  }
});

test("toParameterValue passes through the shapes node-mssql produces", () => {
  const when = new Date("2026-09-06T10:00:00.000Z");
  assert.equal(toParameterValue("x", "c"), "x");
  assert.equal(toParameterValue(0, "c"), 0);
  assert.equal(toParameterValue(false, "c"), false);
  assert.equal(toParameterValue(true, "c"), true);
  // bigint counters arrive as decimal strings; pg accepts them for int8 verbatim.
  assert.equal(toParameterValue("9007199254740993", "c"), "9007199254740993");
  assert.equal(toParameterValue(9007199254740993n, "c"), 9007199254740993n);
  assert.equal(toParameterValue(when, "c"), when);
});

test("toParameterValue normalises absent values and rejects surprises", () => {
  assert.equal(toParameterValue(null, "c"), null);
  assert.equal(toParameterValue(undefined, "c"), null);
  assert.throws(() => toParameterValue(new Date("nope"), "novedu_codes.created_at"), /invalid Date/);
  assert.throws(() => toParameterValue({ a: 1 }, "novedu_codes.note"), /unexpected value type/);
  assert.throws(() => toParameterValue(Buffer.from("ab"), "novedu_files.content"), /unexpected/);
});

test("flattenRows follows the column order, not the row's key order", () => {
  const spec = { table: "novedu_users", columns: ["user_id", "display_name"] };
  const values = flattenRows(spec, [
    { display_name: "Ada", user_id: "oid-1" },
    { user_id: "oid-2", display_name: "Grace" },
  ]);
  assert.deepEqual(values, ["oid-1", "Ada", "oid-2", "Grace"]);
});

test("flattenRows fails loudly when the source row lacks a column", () => {
  const spec = { table: "novedu_users", columns: ["user_id", "display_name"] };
  assert.throws(
    () => flattenRows(spec, [{ user_id: "oid-1" }]),
    /has no column "display_name"/,
  );
});

test("flattenRows keeps NULLs positional", () => {
  const spec = { table: "novedu_codes", columns: ["code", "llm_provider", "llm_model"] };
  assert.deepEqual(flattenRows(spec, [{ code: "abc", llm_provider: null, llm_model: null }]), [
    "abc",
    null,
    null,
  ]);
});

test("diffColumns separates a dropped column from an unlisted one", () => {
  assert.deepEqual(diffColumns(["a", "b"], ["a", "b"]), { missing: [], extra: [] });
  assert.deepEqual(diffColumns(["a", "b"], ["a"]), { missing: ["b"], extra: [] });
  assert.deepEqual(diffColumns(["a"], ["a", "z"]), { missing: [], extra: ["z"] });
});

test("chunk splits without losing or reordering rows", () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 500), []);
  assert.deepEqual(chunk([1], 500), [[1]]);
  assert.throws(() => chunk([1], 0), /positive integer/);
});
