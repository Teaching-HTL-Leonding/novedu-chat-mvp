import { describe, expect, it } from "vitest";
import { buildPreview, PREVIEW_MAX_CHARS } from "@/lib/tutor-history-preview";

// The history row's one-line preview of a conversation's first student message.

describe("buildPreview", () => {
  it("collapses all whitespace and trims", () => {
    expect(buildPreview({ text: "  What\tis\n\n a   prime? ", hasFile: false })).toEqual({
      kind: "text",
      text: "What is a prime?",
    });
  });

  it("keeps a text of exactly the limit whole", () => {
    const text = "a".repeat(PREVIEW_MAX_CHARS);
    expect(buildPreview({ text, hasFile: false })).toEqual({ kind: "text", text });
  });

  it("cuts a longer text on the last word boundary and appends …", () => {
    const words = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    const result = buildPreview({ text: words, hasFile: false });
    expect(result.kind).toBe("text");
    if (result.kind !== "text") return;
    expect(result.text.endsWith("…")).toBe(true);
    const body = result.text.slice(0, -1);
    expect(body.length).toBeLessThanOrEqual(PREVIEW_MAX_CHARS);
    expect(words.startsWith(`${body} `)).toBe(true);
  });

  it("hard-cuts a single word longer than the limit", () => {
    const text = "x".repeat(PREVIEW_MAX_CHARS + 50);
    expect(buildPreview({ text, hasFile: false })).toEqual({
      kind: "text",
      text: `${"x".repeat(PREVIEW_MAX_CHARS)}…`,
    });
  });

  it("is a photo when the message has a photo and no text", () => {
    expect(buildPreview({ text: null, hasFile: true })).toEqual({ kind: "photo" });
    expect(buildPreview({ text: "  \n ", hasFile: true })).toEqual({ kind: "photo" });
  });

  it("shows the text when a photo comes with text", () => {
    expect(buildPreview({ text: "See my homework", hasFile: true })).toEqual({
      kind: "text",
      text: "See my homework",
    });
  });

  it("is empty text without text or photo (the row says '(no text)')", () => {
    expect(buildPreview({ text: null, hasFile: false })).toEqual({ kind: "text", text: "" });
  });
});
