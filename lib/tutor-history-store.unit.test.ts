// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

// The store's own logic, with the database faked: the thread-id guard, the
// never-throw contract, and the conversions raw `execute()` rows need
// (timestamps come back as strings). The SQL itself is exercised against a real
// database by the `@live-db` resume e2e.

const execute = vi.hoisted(() => vi.fn());
const limit = vi.hoisted(() => vi.fn());
// The Drizzle select chain `ownsTutorThread` uses, ending in `.limit()`.
const select = vi.hoisted(() => vi.fn(() => ({ from: () => ({ where: () => ({ limit }) }) })));
vi.mock("@/lib/db", () => ({ getDb: () => ({ execute, select }) }));

import {
  listOwnTutorThreads,
  loadThreadForChat,
  ownsTutorThread,
  TUTOR_HISTORY_LIMIT,
  threadLastMessageAt,
} from "@/lib/tutor-history-store";

const CODE = "c0de";
const THREAD = "0b6f0c1e-1111-4222-8333-444455556666";

function envelope(text: string): string {
  return JSON.stringify({ format: 2, parts: [{ type: "text", text }] });
}

beforeEach(() => {
  execute.mockReset();
  limit.mockReset();
  select.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("threadLastMessageAt", () => {
  it("short-circuits a malformed thread id without a query", async () => {
    expect(await threadLastMessageAt(CODE, "not a uuid; drop")).toBeUndefined();
    expect(execute).not.toHaveBeenCalled();
  });

  it("converts the string timestamp to a Date", async () => {
    execute.mockResolvedValue({ rows: [{ lastAt: "2026-10-09 11:59:00+00" }] });
    expect(await threadLastMessageAt(CODE, THREAD)).toEqual(new Date("2026-10-09 11:59:00+00"));
  });

  it("is null for a thread without messages", async () => {
    execute.mockResolvedValue({ rows: [{ lastAt: null }] });
    expect(await threadLastMessageAt(CODE, THREAD)).toBeNull();
  });

  it("yields undefined on a database error, never throws", async () => {
    execute.mockRejectedValue(new Error("db down"));
    expect(await threadLastMessageAt(CODE, THREAD)).toBeUndefined();
  });
});

describe("loadThreadForChat", () => {
  it("short-circuits a malformed thread id without a query", async () => {
    expect(await loadThreadForChat(CODE, "x".repeat(65))).toBeUndefined();
    expect(execute).not.toHaveBeenCalled();
  });

  it("maps rows to AG-UI messages with their stored ids and the last timestamp", async () => {
    execute.mockResolvedValue({
      rows: [
        { id: "u1", role: "user", content: envelope("Hi"), createdAt: "2026-10-09 11:00:00+00" },
        {
          id: "a1",
          role: "assistant",
          content: envelope("Hello"),
          createdAt: "2026-10-09 11:00:05+00",
        },
      ],
    });
    expect(await loadThreadForChat(CODE, THREAD)).toEqual({
      messages: [
        { id: "u1", role: "user", content: "Hi" },
        { id: "a1", role: "assistant", content: "Hello" },
      ],
      lastMessageAt: new Date("2026-10-09 11:00:05+00"),
    });
  });

  it("is empty with a null timestamp for an unknown thread", async () => {
    execute.mockResolvedValue({ rows: [] });
    expect(await loadThreadForChat(CODE, THREAD)).toEqual({ messages: [], lastMessageAt: null });
  });

  it("yields undefined on a database error, never throws", async () => {
    execute.mockRejectedValue(new Error("db down"));
    expect(await loadThreadForChat(CODE, THREAD)).toBeUndefined();
  });
});

describe("listOwnTutorThreads", () => {
  function row(i: number) {
    return {
      threadId: `t-${i}`,
      lastAt: `2026-10-0${(i % 9) + 1} 10:00:00+00`,
      userCount: "3", // COUNT(*) comes back as a bigint string
      previewText: `  question   ${i} `,
      hasFile: false,
    };
  }

  it("converts timestamps and counts and builds the preview", async () => {
    execute.mockResolvedValue({
      rows: [row(1), { ...row(2), previewText: null, hasFile: true }],
    });
    expect(await listOwnTutorThreads("student-1", CODE)).toEqual({
      threads: [
        {
          threadId: "t-1",
          lastActivityAt: new Date("2026-10-02 10:00:00+00"),
          userMessageCount: 3,
          preview: { kind: "text", text: "question 1" },
        },
        {
          threadId: "t-2",
          lastActivityAt: new Date("2026-10-03 10:00:00+00"),
          userMessageCount: 3,
          preview: { kind: "photo" },
        },
      ],
      more: false,
    });
  });

  it("returns at most the limit and flags `more` from the extra row", async () => {
    execute.mockResolvedValue({
      rows: Array.from({ length: TUTOR_HISTORY_LIMIT + 1 }, (_, i) => row(i)),
    });
    const result = await listOwnTutorThreads("student-1", CODE);
    expect(result?.threads).toHaveLength(TUTOR_HISTORY_LIMIT);
    expect(result?.more).toBe(true);
  });

  it("binds the user and the code as parameters and never selects whole contents", async () => {
    execute.mockResolvedValue({ rows: [] });
    await listOwnTutorThreads("student-1", CODE);
    const query = execute.mock.calls[0]?.[0] as { queryChunks: unknown[] };
    const params = query.queryChunks.filter((chunk) => typeof chunk !== "object");
    expect(params).toEqual(expect.arrayContaining(["student-1", CODE]));
    const text = JSON.stringify(query.queryChunks);
    expect(text).not.toMatch(/SELECT m\.content|m\.content AS/);
  });

  it("yields undefined on a database error, never throws", async () => {
    execute.mockRejectedValue(new Error("db down"));
    expect(await listOwnTutorThreads("student-1", CODE)).toBeUndefined();
  });
});

describe("ownsTutorThread", () => {
  it("is true with a matching row, false without", async () => {
    limit.mockResolvedValueOnce([{ threadId: THREAD }]).mockResolvedValueOnce([]);
    expect(await ownsTutorThread("student-1", CODE, THREAD)).toBe(true);
    expect(await ownsTutorThread("student-1", CODE, THREAD)).toBe(false);
  });

  it("is false for a malformed thread id without a query", async () => {
    expect(await ownsTutorThread("student-1", CODE, "a b")).toBe(false);
    expect(select).not.toHaveBeenCalled();
  });

  it("yields undefined on a database error, never throws", async () => {
    limit.mockRejectedValue(new Error("db down"));
    expect(await ownsTutorThread("student-1", CODE, THREAD)).toBeUndefined();
  });
});
