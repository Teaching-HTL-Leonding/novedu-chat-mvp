// @vitest-environment node
import { Writable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The export runner's failure paths, which the built-binary integration test
// (cli/test/export.integration.test.ts) cannot stage: a sink that fails WHILE a
// page request is in flight, a cursor that does not move, and a malformed page. The API seam (`./api`) and the file open are mocked; the --out sink is an
// in-memory Writable the test controls.

const mocks = vi.hoisted(() => ({
  performApiRequest: vi.fn(),
  failJson: vi.fn(),
  printJson: vi.fn(),
  open: vi.fn(),
  rm: vi.fn(),
}));

vi.mock("./api", () => ({
  performApiRequest: mocks.performApiRequest,
  failJson: mocks.failJson,
  printJson: mocks.printJson,
}));
vi.mock("node:fs/promises", () => ({ open: mocks.open, rm: mocks.rm }));

import { runConversationExport } from "./conversation-export";

const CODE_BLOCK = {
  code: "k7f3qz",
  module: "tutor",
  note: null,
  fileUrl: "https://example.test/t.yaml",
  anonymous: true,
};

function conversation(threadId: string) {
  return {
    threadId,
    startedAt: "2026-10-07T09:00:00.000Z",
    endedAt: "2026-10-07T09:01:00.000Z",
    truncated: false,
    messages: [
      { role: "user", createdAt: "2026-10-07T09:00:00.000Z", content: "Hallo" },
      { role: "assistant", createdAt: "2026-10-07T09:01:00.000Z", content: "Hi" },
    ],
  };
}

function page(threadId: string, nextCursor: string | null) {
  return {
    ok: true,
    payload: { code: CODE_BLOCK, conversations: [conversation(threadId)], nextCursor },
  };
}

let written: string;
let sink: Writable;

beforeEach(() => {
  vi.clearAllMocks();
  written = "";
  sink = new Writable({
    write(chunk, _encoding, callback) {
      written += String(chunk);
      callback();
    },
  });
  mocks.open.mockResolvedValue({ createWriteStream: () => sink });
  mocks.rm.mockResolvedValue(undefined);
});

describe("runConversationExport --out", () => {
  it("walks every page, writes header + conversations and prints the summary", async () => {
    mocks.performApiRequest
      .mockResolvedValueOnce(page("t1", "c1"))
      .mockResolvedValueOnce(page("t2", null));
    await runConversationExport("k7f3qz", { out: "out.jsonl" });
    const lines = written
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(lines.map((line) => line.type)).toEqual(["export", "conversation", "conversation"]);
    expect(mocks.performApiRequest.mock.calls[1]?.[0].path).toContain("after=c1");
    expect(mocks.printJson).toHaveBeenCalledWith({
      code: "k7f3qz",
      file: "out.jsonl",
      conversations: 2,
      messages: 4,
    });
    expect(mocks.failJson).not.toHaveBeenCalled();
    expect(mocks.rm).not.toHaveBeenCalled();
  });

  it("reports a sink failure that happens while the next page is in flight, and removes the file", async () => {
    mocks.performApiRequest
      .mockResolvedValueOnce(page("t1", "c1"))
      .mockImplementationOnce(async () => {
        // The disk fills up between two pages.
        sink.destroy(Object.assign(new Error("no space left on device"), { code: "ENOSPC" }));
        await new Promise((resolve) => setImmediate(resolve));
        return page("t2", null);
      });
    await runConversationExport("k7f3qz", { out: "out.jsonl" });
    expect(mocks.failJson).toHaveBeenCalledWith({
      message: expect.stringContaining("no space left on device"),
    });
    expect(mocks.rm).toHaveBeenCalledWith("out.jsonl", { force: true });
    expect(mocks.printJson).not.toHaveBeenCalled();
  });

  it("does not hang when the sink dies with a full buffer", async () => {
    // A sink whose writes never complete: the buffer fills and `write` returns false.
    sink = new Writable({ highWaterMark: 1, write() {} });
    mocks.open.mockResolvedValue({ createWriteStream: () => sink });
    mocks.performApiRequest.mockImplementationOnce(async () => {
      setTimeout(() => sink.destroy(new Error("device gone")), 10);
      return page("t1", null);
    });
    await runConversationExport("k7f3qz", { out: "out.jsonl" });
    expect(mocks.failJson).toHaveBeenCalledWith({
      message: expect.stringContaining("Could not write"),
    });
    expect(mocks.rm).toHaveBeenCalled();
  });

  it("stops a server whose cursor does not move", async () => {
    mocks.performApiRequest
      .mockResolvedValueOnce(page("t1", "a"))
      .mockResolvedValueOnce(page("t1", "a"));
    await runConversationExport("k7f3qz", { out: "out.jsonl" });
    expect(mocks.performApiRequest).toHaveBeenCalledTimes(2);
    expect(mocks.failJson).toHaveBeenCalledWith({
      message: "Unexpected response from the server's conversation export.",
    });
    expect(mocks.rm).toHaveBeenCalled();
    expect(mocks.printJson).not.toHaveBeenCalled();
  });

  it.each([
    ["an empty code block", { code: {}, conversations: [], nextCursor: null }],
    ["a missing conversations array", { code: CODE_BLOCK, nextCursor: null }],
    [
      "messages that are not an array",
      {
        code: CODE_BLOCK,
        conversations: [{ ...conversation("t1"), messages: "oops" }],
        nextCursor: null,
      },
    ],
    ["a numeric cursor", { code: CODE_BLOCK, conversations: [], nextCursor: 7 }],
  ])("rejects a malformed page (%s) before writing any of it", async (_label, payload) => {
    mocks.performApiRequest.mockResolvedValueOnce({ ok: true, payload });
    await runConversationExport("k7f3qz", { out: "out.jsonl" });
    expect(written).toBe("");
    expect(mocks.failJson).toHaveBeenCalledWith({
      message: "Unexpected response from the server's conversation export.",
    });
    expect(mocks.rm).toHaveBeenCalled();
    expect(mocks.printJson).not.toHaveBeenCalled();
  });

  it("removes the file when the server rejects the request (already reported by the API seam)", async () => {
    mocks.performApiRequest.mockResolvedValueOnce({
      ok: false,
      error: { message: "Forbidden" },
      status: 403,
    });
    await runConversationExport("k7f3qz", { out: "out.jsonl" });
    expect(mocks.rm).toHaveBeenCalledWith("out.jsonl", { force: true });
    expect(mocks.failJson).not.toHaveBeenCalled();
  });
});
