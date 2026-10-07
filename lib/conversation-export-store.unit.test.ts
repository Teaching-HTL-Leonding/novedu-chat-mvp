// @vitest-environment node
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The store over a fake `execute` that records each statement (rendered to SQL
// text via drizzle's own dialect) and answers from a per-call script — the
// lib/code-stats-store.unit.test.ts pattern. The live SQL itself is proven by
// e2e/api-conversations.live.spec.ts.

const fake = vi.hoisted(() => {
  const state = {
    responses: [] as Record<string, unknown>[][],
    statements: [] as unknown[],
    executeError: undefined as unknown,
  };
  const db = {
    execute: async (statement: unknown) => {
      state.statements.push(statement);
      if (state.executeError) throw state.executeError;
      return { rows: state.responses.shift() ?? [] };
    },
  };
  return { state, db };
});

vi.mock("@/lib/db", () => ({ getDb: () => fake.db }));

import { decodeCursor, MAX_MESSAGES_PER_CONVERSATION } from "@/lib/conversation-export";
import { listConversationPage } from "@/lib/conversation-export-store";

const dialect = new PgDialect();
function rendered(index: number): { sql: string; params: unknown[] } {
  return dialect.sqlToQuery(fake.state.statements[index] as SQL);
}

function thread(id: string, createdAt = "2026-10-07T09:00:00.000000") {
  return { id, createdAt };
}

function message(
  threadId: string,
  role: string,
  text: string,
  createdAt = "2026-10-07 09:00:01.5+00",
) {
  return {
    threadId,
    role,
    createdAt,
    content: JSON.stringify({ parts: [{ type: "text", text }] }),
  };
}

beforeEach(() => {
  fake.state.responses = [];
  fake.state.statements = [];
  fake.state.executeError = undefined;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("listConversationPage", () => {
  it("returns a cursor and drops the extra row when limit + 1 threads come back", async () => {
    fake.state.responses = [
      [
        thread("t1", "2026-10-07T09:00:00.000001"),
        thread("t2", "2026-10-07T09:00:00.000002"),
        thread("t3"),
      ],
      [message("t1", "user", "a"), message("t2", "user", "b")],
    ];
    const page = await listConversationPage("k7f3qz", { limit: 2 });
    expect(page?.conversations.map((c) => c.threadId)).toEqual(["t1", "t2"]);
    expect(decodeCursor(page?.nextCursor ?? "")).toEqual({
      createdAt: "2026-10-07T09:00:00.000002",
      id: "t2",
    });
    // The thread statement asks for limit + 1; the message statement covers exactly the page.
    expect(rendered(0).params).toEqual(["k7f3qz", 3]);
    expect(rendered(1).params).toEqual(["t1", "t2", MAX_MESSAGES_PER_CONVERSATION + 1]);
  });

  it("returns a null cursor when exactly limit threads come back", async () => {
    fake.state.responses = [
      [thread("t1"), thread("t2")],
      [message("t1", "user", "a"), message("t2", "user", "b")],
    ];
    const page = await listConversationPage("k7f3qz", { limit: 2 });
    expect(page?.conversations).toHaveLength(2);
    expect(page?.nextCursor).toBeNull();
  });

  it("runs no message statement for an empty page", async () => {
    fake.state.responses = [[]];
    expect(await listConversationPage("k7f3qz", { limit: 25 })).toEqual({
      conversations: [],
      nextCursor: null,
    });
    expect(fake.state.statements).toHaveLength(1);
  });

  it("passes the cursor position into the thread statement", async () => {
    fake.state.responses = [[]];
    await listConversationPage("k7f3qz", {
      after: { createdAt: "2026-10-07T09:00:00.000002", id: "t2" },
      limit: 25,
    });
    const { sql, params } = rendered(0);
    expect(sql).toContain('(t."createdAt", t.id) >');
    expect(params).toEqual(["k7f3qz", "2026-10-07T09:00:00.000002", "t2", 26]);
  });

  it("groups messages per thread, converts wire timestamps and keeps the cursor when a thread drops", async () => {
    fake.state.responses = [
      [thread("t1"), thread("t2"), thread("t3")],
      [
        message("t1", "user", "hi", "2026-10-07 09:00:01.5+00"),
        message("t1", "assistant", "hello", "2026-10-07 09:00:03+00"),
        // t2's only user row is malformed content → no user message survives → dropped.
        { threadId: "t2", role: "user", createdAt: "2026-10-07 09:00:04+00", content: "broken" },
      ],
    ];
    const page = await listConversationPage("k7f3qz", { limit: 2 });
    expect(page?.conversations).toEqual([
      {
        threadId: "t1",
        startedAt: "2026-10-07T09:00:01.500Z",
        endedAt: "2026-10-07T09:00:03.000Z",
        truncated: false,
        messages: [
          { role: "user", createdAt: "2026-10-07T09:00:01.500Z", content: "hi" },
          { role: "assistant", createdAt: "2026-10-07T09:00:03.000Z", content: "hello" },
        ],
      },
    ]);
    expect(page?.nextCursor).not.toBeNull();
  });

  it("keeps the last MAX messages of a thread that returned MAX + 1 rows and marks it truncated", async () => {
    const stamp = (i: number) => new Date(Date.UTC(2026, 9, 7, 9, 0, 0) + i * 1000).toISOString();
    const rows = Array.from({ length: MAX_MESSAGES_PER_CONVERSATION + 1 }, (_, i) =>
      message("t1", i % 2 === 0 ? "user" : "assistant", `m${i}`, stamp(i)),
    );
    fake.state.responses = [
      [thread("t1"), thread("t2")],
      [...rows, message("t2", "user", "short")],
    ];
    const page = await listConversationPage("k7f3qz", { limit: 5 });
    const [long, short] = page?.conversations ?? [];
    expect(long?.truncated).toBe(true);
    expect(long?.messages).toHaveLength(MAX_MESSAGES_PER_CONVERSATION);
    expect(long?.messages[0]?.content).toBe("m1");
    expect(long?.startedAt).toBe(stamp(1));
    expect(short?.truncated).toBe(false);
    // The cap is applied in SQL — ids picked by a window before any content is read.
    expect(rendered(1).sql).toMatch(/ROW_NUMBER\(\) OVER \(\s*PARTITION BY k\.thread_id/);
  });

  it("returns undefined and never throws on a database error", async () => {
    fake.state.executeError = new Error("connection lost");
    await expect(listConversationPage("k7f3qz", { limit: 25 })).resolves.toBeUndefined();
  });

  it("never touches the identity tables and reads content only through the jsonb rebuild", async () => {
    fake.state.responses = [[thread("t1")], [message("t1", "user", "a")]];
    await listConversationPage("k7f3qz", {
      after: { createdAt: "2026-10-07T09:00:00.000000", id: "t0" },
      limit: 5,
    });
    expect(fake.state.statements).toHaveLength(2);
    for (const index of [0, 1]) {
      const { sql } = rendered(index);
      expect(sql).not.toMatch(/novedu_user/);
      expect(sql).not.toMatch(/novedu_/);
    }
    // Statement 1 reads no content at all; statement 2 only inside the rebuild.
    expect(rendered(0).sql).not.toMatch(/content/);
    const messageSql = rendered(1).sql;
    expect(messageSql.match(/m\.content/g)).toEqual(["m.content", "m.content"]);
    expect(messageSql).toContain("(m.content::jsonb)->'parts'");
    expect(messageSql).toMatch(/\)::text AS content/);
  });
});
