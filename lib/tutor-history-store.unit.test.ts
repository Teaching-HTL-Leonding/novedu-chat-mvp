// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

// The store's own logic, with the database faked: the thread-id guard, the
// never-throw contract, and the conversions raw `execute()` rows need
// (timestamps come back as strings). The SQL itself is exercised against a real
// database by the `@live-db` resume e2e.

const execute = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ getDb: () => ({ execute }) }));

import { loadThreadForChat, threadLastMessageAt } from "@/lib/tutor-history-store";

const CODE = "c0de";
const THREAD = "0b6f0c1e-1111-4222-8333-444455556666";

function envelope(text: string): string {
  return JSON.stringify({ format: 2, parts: [{ type: "text", text }] });
}

beforeEach(() => {
  execute.mockReset();
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
