import { describe, expect, it } from "vitest";
import {
  buildConversation,
  decodeCursor,
  type ExportMessage,
  type ExportRow,
  encodeCursor,
  exportMessageKey,
  MAX_MESSAGES_PER_CONVERSATION,
  toExportMessage,
} from "@/lib/conversation-export";

// The pure half of the conversation export: row → message mapping, the collapse
// identity, conversation assembly and the cursor codec. No mocks — the store
// hands these SQL-shaped rows whose `file` parts are already placeholders.

const AT = new Date("2026-10-07T09:00:00.000Z");

function row(role: string, parts: unknown[], createdAt = AT): ExportRow {
  return { role, createdAt, content: JSON.stringify({ parts }) };
}

function at(seconds: number): Date {
  return new Date(AT.getTime() + seconds * 1000);
}

describe("toExportMessage", () => {
  it("collapses a text-only message to a plain string", () => {
    expect(
      toExportMessage(
        row("user", [
          { type: "text", text: "Wie berechne " },
          { type: "text", text: "ich das?" },
        ]),
      ),
    ).toEqual({ role: "user", createdAt: AT.toISOString(), content: "Wie berechne ich das?" });
  });

  it("keeps text + image placeholder as parts in stored order", () => {
    expect(
      toExportMessage(
        row("user", [
          { type: "text", text: "Hier mein Versuch:" },
          { type: "file", mimeType: "image/jpeg", bytes: 1834211 },
        ]),
      )?.content,
    ).toEqual([
      { type: "text", text: "Hier mein Versuch:" },
      { type: "image", mimeType: "image/jpeg", bytes: 1834211 },
    ]);
  });

  it("maps an unknown placeholder size / type to null", () => {
    expect(
      toExportMessage(row("user", [{ type: "file", mimeType: "", bytes: null }]))?.content,
    ).toEqual([{ type: "image", mimeType: null, bytes: null }]);
  });

  it("maps a stored tool result to a tool part and drops step-start", () => {
    // The shape Mastra persists for a tutor granted `tools:`.
    const message = toExportMessage(
      row("assistant", [
        {
          type: "tool-invocation",
          toolInvocation: {
            state: "result",
            toolCallId: "call-1",
            toolName: "random_number",
            args: { min: 1, max: 6 },
            result: { value: 4 },
          },
        },
        { type: "step-start" },
        { type: "text", text: "Your number is 4." },
      ]),
    );
    expect(message?.content).toEqual([
      { type: "tool", name: "random_number", args: { min: 1, max: 6 }, result: { value: 4 } },
      { type: "text", text: "Your number is 4." },
    ]);
  });

  it("gives a call that never got a result a null result", () => {
    const message = toExportMessage(
      row("assistant", [
        {
          type: "tool-invocation",
          toolInvocation: { state: "call", toolCallId: "c", toolName: "t", args: {} },
        },
      ]),
    );
    expect(message?.content).toEqual([{ type: "tool", name: "t", args: {}, result: null }]);
  });

  it("drops unknown parts (reasoning, step-start, …)", () => {
    expect(
      toExportMessage(
        row("assistant", [
          { type: "reasoning", text: "secret" },
          { type: "text", text: "Hi" },
          { type: "source-url", url: "x" },
        ]),
      )?.content,
    ).toBe("Hi");
  });

  it("keeps a message whose parts all drop as an empty string", () => {
    expect(toExportMessage(row("assistant", [{ type: "step-start" }]))?.content).toBe("");
    expect(toExportMessage({ role: "user", createdAt: AT, content: "{}" })?.content).toBe("");
  });

  it("returns null for roles other than user/assistant and for malformed content", () => {
    expect(toExportMessage(row("system", [{ type: "text", text: "x" }]))).toBeNull();
    expect(toExportMessage(row("tool", [{ type: "text", text: "x" }]))).toBeNull();
    expect(toExportMessage({ role: "user", createdAt: AT, content: "not json" })).toBeNull();
  });
});

describe("exportMessageKey", () => {
  const base: ExportMessage = { role: "assistant", createdAt: AT.toISOString(), content: "x" };

  it("ignores createdAt and tool parts", () => {
    expect(exportMessageKey(base)).toBe(
      exportMessageKey({ ...base, createdAt: at(5).toISOString() }),
    );
    const withTool: ExportMessage = {
      ...base,
      content: [
        { type: "tool", name: "t", args: {}, result: 1 },
        { type: "text", text: "x" },
      ],
    };
    expect(exportMessageKey(withTool)).toBe(exportMessageKey(base));
  });

  it("tells apart role, text and images", () => {
    const withImage: ExportMessage = {
      ...base,
      content: [
        { type: "text", text: "x" },
        { type: "image", mimeType: "image/png", bytes: 3 },
      ],
    };
    expect(exportMessageKey(withImage)).not.toBe(exportMessageKey(base));
    expect(exportMessageKey({ ...base, role: "user" })).not.toBe(exportMessageKey(base));
    expect(exportMessageKey({ ...base, content: "y" })).not.toBe(exportMessageKey(base));
  });
});

describe("buildConversation", () => {
  it("collapses telescoping replays and takes start/end from the survivors", () => {
    // R1 = [u1, a1], R2 = [u1, a1, u2, a2] — the replayed history of an
    // old conversation; R1 is a prefix of R2 and drops.
    const rows = [
      row("user", [{ type: "text", text: "u1" }], at(0)),
      row("assistant", [{ type: "text", text: "a1" }], at(1)),
      row("user", [{ type: "text", text: "u1" }], at(2)),
      row("assistant", [{ type: "text", text: "a1" }], at(3)),
      row("user", [{ type: "text", text: "u2" }], at(4)),
      row("assistant", [{ type: "text", text: "a2" }], at(5)),
    ];
    const conversation = buildConversation("thread-1", rows);
    expect(conversation?.messages.map((m) => m.content)).toEqual(["u1", "a1", "u2", "a2"]);
    expect(conversation?.startedAt).toBe(at(2).toISOString());
    expect(conversation?.endedAt).toBe(at(5).toISOString());
    expect(conversation?.threadId).toBe("thread-1");
    expect(conversation?.truncated).toBe(false);
  });

  it("returns null when no user message survives", () => {
    expect(buildConversation("t", [row("assistant", [{ type: "text", text: "hi" }])])).toBeNull();
    expect(buildConversation("t", [{ role: "user", createdAt: AT, content: "broken" }])).toBeNull();
    expect(buildConversation("t", [])).toBeNull();
  });

  it("keeps only the last MAX messages of a thread the store read MAX + 1 rows of", () => {
    const rows = Array.from({ length: MAX_MESSAGES_PER_CONVERSATION + 1 }, (_, i) =>
      row(i % 2 === 0 ? "user" : "assistant", [{ type: "text", text: `m${i}` }], at(i)),
    );
    const conversation = buildConversation("t", rows);
    expect(conversation?.truncated).toBe(true);
    expect(conversation?.messages).toHaveLength(MAX_MESSAGES_PER_CONVERSATION);
    expect(conversation?.messages[0]?.content).toBe("m1");
    expect(conversation?.startedAt).toBe(at(1).toISOString());
  });

  it("keeps a truncated conversation even when the cut removed its only user message", () => {
    const rows = [
      row("user", [{ type: "text", text: "hi" }], at(0)),
      ...Array.from({ length: MAX_MESSAGES_PER_CONVERSATION }, (_, i) =>
        row("assistant", [{ type: "text", text: `a${i}` }], at(i + 1)),
      ),
    ];
    const conversation = buildConversation("t", rows);
    expect(conversation?.truncated).toBe(true);
    expect(conversation?.messages.every((m) => m.role === "assistant")).toBe(true);
  });
});

describe("cursor", () => {
  const cursor = {
    createdAt: "2026-10-07T09:12:44.123456",
    id: "371d6901-963c-44db-87f0-f91b068cd078",
  };

  it("round-trips and is opaque base64url", () => {
    const encoded = encodeCursor(cursor);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(encoded)).toEqual(cursor);
  });

  it("rejects malformed cursors", () => {
    const enc = (text: string) => Buffer.from(text, "utf8").toString("base64url");
    expect(decodeCursor("")).toBeNull();
    expect(decodeCursor("not base64!")).toBeNull();
    expect(decodeCursor(enc("2026-10-07T09:12:44.123456"))).toBeNull();
    expect(decodeCursor(enc(`2026-10-07T09:12:44.123Z|${cursor.id}`))).toBeNull();
    expect(decodeCursor(enc(`2026-10-07 09:12:44.123456|${cursor.id}`))).toBeNull();
    expect(decodeCursor(enc("2026-10-07T09:12:44.123456|bad id'"))).toBeNull();
    expect(decodeCursor(enc(`2026-10-07T09:12:44.123456|${cursor.id}|extra`))).toBeNull();
    expect(decodeCursor("A".repeat(201))).toBeNull();
  });
});
