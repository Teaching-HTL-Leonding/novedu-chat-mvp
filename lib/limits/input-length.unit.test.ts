import { describe, expect, it } from "vitest";
import { userTextLength } from "./input-length";

describe("userTextLength", () => {
  it("counts a string user message", () => {
    expect(userTextLength([{ role: "user", content: "hello" }])).toBe(5);
  });

  it("counts only the text parts of a parts array", () => {
    expect(
      userTextLength([
        {
          role: "user",
          content: [
            { type: "text", text: "abc" },
            { type: "binary", mimeType: "image/png", data: "A".repeat(1000) },
            { type: "text", text: "de" },
          ],
        },
      ]),
    ).toBe(5);
  });

  it("sums several user messages", () => {
    expect(
      userTextLength([
        { role: "user", content: "abc" },
        { role: "user", content: "de" },
      ]),
    ).toBe(5);
  });

  it("ignores assistant, system and tool messages", () => {
    expect(
      userTextLength([
        { role: "assistant", content: "x".repeat(100) },
        { role: "system", content: "x".repeat(100) },
        { role: "tool", toolCallId: "c1", content: "x".repeat(100) },
      ]),
    ).toBe(0);
  });

  it("tolerates junk without throwing", () => {
    expect(
      userTextLength([
        null,
        42,
        "user",
        { role: "user" },
        { role: "user", content: 7 },
        { role: "user", content: [null, { type: "text" }, { type: "text", text: 3 }] },
      ]),
    ).toBe(0);
  });
});
