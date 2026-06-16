// @vitest-environment node

import type { Message } from "@ag-ui/core";
import { describe, expect, it } from "vitest";
import { collapseReplayedRuns, toAguiMessage } from "@/lib/conversation-collapse";

// Pure helpers behind the conversation viewer (lib/tutor-stats-store.ts). The
// end-to-end "getConversationMessages collapses replays" test lives in the
// store's test; here we pin the pure logic directly.

describe("collapseReplayedRuns", () => {
  const u = (text: string): Message => ({ id: crypto.randomUUID(), role: "user", content: text });
  const a = (text: string): Message => ({
    id: crypto.randomUUID(),
    role: "assistant",
    content: text,
  });

  it("returns short conversations untouched", () => {
    expect(collapseReplayedRuns([])).toEqual([]);
    const one = [u("hi")];
    expect(collapseReplayedRuns(one)).toBe(one);
  });

  it("leaves a clean (non-telescoping) conversation unchanged", () => {
    const messages = [u("hi"), a("hello"), u("more"), a("sure")];
    const result = collapseReplayedRuns(messages);
    expect(result.map((m) => m.content)).toEqual(["hi", "hello", "more", "sure"]);
  });

  it("collapses telescoping replays to the final, complete run", () => {
    // Each run re-sends the whole prefix then appends one new turn — the exact
    // shape Mastra persisted before the route-level fix.
    const messages = [
      // run 1
      u("hi"),
      a("hello"),
      // run 2 (re-sends hi/hello, adds turn 2)
      u("hi"),
      a("hello"),
      u("q2"),
      a("ans2"),
      // run 3 (re-sends all, adds turn 3)
      u("hi"),
      a("hello"),
      u("q2"),
      a("ans2"),
      u("q3"),
      a("ans3"),
    ];
    const result = collapseReplayedRuns(messages);
    expect(result.map((m) => `${m.role}:${m.content}`)).toEqual([
      "user:hi",
      "assistant:hello",
      "user:q2",
      "assistant:ans2",
      "user:q3",
      "assistant:ans3",
    ]);
  });

  it("preserves a genuinely retyped opening line (not a prefix of the next run)", () => {
    // The student literally retypes the first message mid-conversation. Because
    // the second 'run' is NOT a prefix of anything after it, no content is lost.
    const messages = [u("start"), a("ok"), u("start"), a("again")];
    const result = collapseReplayedRuns(messages);
    expect(result.map((m) => `${m.role}:${m.content}`)).toEqual([
      "user:start",
      "assistant:ok",
      "user:start",
      "assistant:again",
    ]);
  });

  it("collapses replays even when the final run is missing its last reply", () => {
    const messages = [
      u("hi"),
      a("hello"),
      // final run re-sends the prefix and ends on an unanswered user turn
      u("hi"),
      a("hello"),
      u("pending"),
    ];
    const result = collapseReplayedRuns(messages);
    expect(result.map((m) => `${m.role}:${m.content}`)).toEqual([
      "user:hi",
      "assistant:hello",
      "user:pending",
    ]);
  });

  it("dedupes on rendered content, ignoring differing ids", () => {
    const messages: Message[] = [
      { id: "x1", role: "user", content: "hi" },
      { id: "x2", role: "assistant", content: "hello" },
      { id: "y1", role: "user", content: "hi" },
      { id: "y2", role: "assistant", content: "hello" },
      { id: "y3", role: "user", content: "next" },
    ];
    const result = collapseReplayedRuns(messages);
    expect(result.map((m) => m.content)).toEqual(["hi", "hello", "next"]);
  });
});

describe("toAguiMessage", () => {
  const row = (id: string, role: string, content: unknown) => ({
    id,
    role,
    content: JSON.stringify(content),
  });

  it("rebuilds text from parts and preserves the row id", () => {
    expect(
      toAguiMessage(row("m1", "user", { parts: [{ type: "text", text: "Hi" }], content: "Hi" })),
    ).toEqual({ id: "m1", role: "user", content: "Hi" });
  });

  it("maps a file part to an inline image and skips non-chat roles / bad JSON", () => {
    const dataUrl = "data:image/png;base64,AAAA";
    expect(toAguiMessage(row("m1", "user", { parts: [{ type: "file", data: dataUrl }] }))).toEqual({
      id: "m1",
      role: "user",
      content: [{ type: "image", source: { type: "url", value: dataUrl } }],
    });
    expect(toAguiMessage(row("s", "system", { parts: [{ type: "text", text: "x" }] }))).toBeNull();
    expect(toAguiMessage({ id: "bad", role: "user", content: "not json{" })).toBeNull();
  });
});
