import { describe, expect, it } from "vitest";
import {
  chatErrorMessage,
  GENERIC_CHAT_ERROR,
  isRejectedRunRequest,
  splitUnansweredTurn,
} from "./chat-error";

const httpError = (status: number, body: unknown) =>
  new Error(`HTTP ${status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);

describe("chatErrorMessage", () => {
  it("shows the route's own sentence for the input limit (413)", () => {
    const text = "This message is too long. Please shorten it to at most 8,000 characters.";
    expect(chatErrorMessage(httpError(413, { error: text }))).toBe(text);
  });

  it("shows the route's own sentence for a closed code window (403)", () => {
    const text = "This activity's availability window has ended.";
    expect(chatErrorMessage(httpError(403, { error: text }))).toBe(text);
  });

  it("falls back for a 5xx, even when the body carries an error text", () => {
    expect(chatErrorMessage(httpError(500, { error: "db password wrong at pool.ts" }))).toBe(
      GENERIC_CHAT_ERROR,
    );
  });

  it("falls back for a 4xx whose body is not our JSON", () => {
    expect(chatErrorMessage(httpError(404, "<html>not found</html>"))).toBe(GENERIC_CHAT_ERROR);
    expect(chatErrorMessage(httpError(400, { message: "x" }))).toBe(GENERIC_CHAT_ERROR);
    expect(chatErrorMessage(httpError(400, { error: "   " }))).toBe(GENERIC_CHAT_ERROR);
  });

  it("falls back for an in-band run error or a network failure (never echoes it)", () => {
    expect(chatErrorMessage(new Error("upstream said: <the student's prompt>"))).toBe(
      GENERIC_CHAT_ERROR,
    );
    expect(chatErrorMessage(new TypeError("Failed to fetch"))).toBe(GENERIC_CHAT_ERROR);
  });

  it("falls back for a non-Error value", () => {
    expect(chatErrorMessage("HTTP 413: {}")).toBe(GENERIC_CHAT_ERROR);
    expect(chatErrorMessage(undefined)).toBe(GENERIC_CHAT_ERROR);
  });

  it("keeps a multi-line body intact", () => {
    expect(chatErrorMessage(new Error('HTTP 413: {\n  "error": "Too long."\n}'))).toBe("Too long.");
  });
});

describe("isRejectedRunRequest", () => {
  it("is true for a 4xx the route answered", () => {
    expect(isRejectedRunRequest(httpError(413, { error: "x" }))).toBe(true);
    expect(isRejectedRunRequest(httpError(403, { error: "x" }))).toBe(true);
  });

  it("is false for a 5xx, an in-band error or a non-Error", () => {
    expect(isRejectedRunRequest(httpError(502, { error: "x" }))).toBe(false);
    expect(isRejectedRunRequest(new Error("model exploded"))).toBe(false);
    expect(isRejectedRunRequest(undefined)).toBe(false);
  });
});

describe("splitUnansweredTurn", () => {
  const user = (content: unknown) => ({ role: "user", content });
  const assistant = { role: "assistant", content: "answer" };

  it("drops the trailing user messages after the last reply", () => {
    const history = [user("q1"), assistant, user("long one"), user("short one")];
    const { kept, dropped, unsentText } = splitUnansweredTurn(history);
    expect(kept).toEqual([user("q1"), assistant]);
    expect(dropped).toEqual([user("long one"), user("short one")]);
    expect(unsentText).toBe("long one\n\nshort one");
  });

  it("drops the whole history on the first turn", () => {
    expect(splitUnansweredTurn([user("first")]).kept).toEqual([]);
  });

  it("drops nothing when the history ends with a reply", () => {
    const history = [user("q1"), assistant];
    expect(splitUnansweredTurn(history)).toEqual({ kept: history, dropped: [], unsentText: "" });
  });

  it("never drops a frontend tool's result", () => {
    const tool = { role: "tool", content: "the essay" };
    expect(splitUnansweredTurn([user("q"), tool]).dropped).toEqual([]);
  });

  it("copies only the text parts of a message with a photo", () => {
    const withPhoto = user([
      { type: "text", text: "what is this?" },
      { type: "binary", mimeType: "image/png", data: "AAAA" },
    ]);
    expect(splitUnansweredTurn([withPhoto]).unsentText).toBe("what is this?");
  });
});
