import { describe, expect, it } from "vitest";
import { buildUpstreamChatBody, openaiError, parseBearerKey } from "@/lib/coding-proxy";

// The pure helpers behind the OpenAI-compatible coding proxy: bearer-key parsing,
// the request body transform (system-prompt merge + model pin + verbatim
// passthrough), and the OpenAI error envelope.

describe("parseBearerKey", () => {
  it("extracts the token from a Bearer header", () => {
    expect(parseBearerKey("Bearer abc123")).toBe("abc123");
  });

  it("is case-insensitive on the scheme and tolerates extra spaces", () => {
    expect(parseBearerKey("bearer   abc123")).toBe("abc123");
  });

  it("returns the token VERBATIM — it does not strip an sk- prefix (the code IS the key)", () => {
    expect(parseBearerKey("Bearer sk-abc123")).toBe("sk-abc123");
    expect(parseBearerKey("Bearer sk-")).toBe("sk-");
  });

  it("returns null for missing / non-bearer / empty values", () => {
    expect(parseBearerKey(null)).toBeNull();
    expect(parseBearerKey("")).toBeNull();
    expect(parseBearerKey("Basic abc123")).toBeNull();
    expect(parseBearerKey("Bearer    ")).toBeNull();
  });
});

describe("buildUpstreamChatBody", () => {
  it("adds a leading system message when the client sent none, and PINS the model", () => {
    const out = buildUpstreamChatBody(
      { model: "client-picked", messages: [{ role: "user", content: "hi" }] },
      { instructions: "TEACHER PROMPT", model: "gemma-pinned" },
    );
    expect(out.model).toBe("gemma-pinned");
    expect(out.messages).toEqual([
      { role: "system", content: "TEACHER PROMPT" },
      { role: "user", content: "hi" },
    ]);
  });

  it("appends the teacher prompt to the END of the client's existing system message", () => {
    const out = buildUpstreamChatBody(
      {
        messages: [
          { role: "system", content: "CLIENT PROMPT" },
          { role: "user", content: "hi" },
        ],
      },
      { instructions: "TEACHER PROMPT", model: "m" },
    );
    expect(out.messages).toEqual([
      { role: "system", content: "CLIENT PROMPT\n\nTEACHER PROMPT" },
      { role: "user", content: "hi" },
    ]);
  });

  it("appends a text part when the client's system content is a content-parts array", () => {
    const out = buildUpstreamChatBody(
      { messages: [{ role: "system", content: [{ type: "text", text: "CLIENT" }] }] },
      { instructions: "TEACHER", model: "m" },
    );
    expect(out.messages).toEqual([
      {
        role: "system",
        content: [
          { type: "text", text: "CLIENT" },
          { type: "text", text: "TEACHER" },
        ],
      },
    ]);
  });

  it("passes tools, tool_choice, temperature, and stream through verbatim", () => {
    const tools = [{ type: "function", function: { name: "read_file" } }];
    const out = buildUpstreamChatBody(
      { messages: [], tools, tool_choice: "auto", temperature: 0.2, stream: true },
      { instructions: "P", model: "m" },
    );
    expect(out.tools).toBe(tools);
    expect(out.tool_choice).toBe("auto");
    expect(out.temperature).toBe(0.2);
    expect(out.stream).toBe(true);
  });

  it("tolerates a missing messages array", () => {
    const out = buildUpstreamChatBody({}, { instructions: "P", model: "m" });
    expect(out.messages).toEqual([{ role: "system", content: "P" }]);
  });
});

describe("openaiError", () => {
  it("builds the OpenAI error envelope", () => {
    expect(openaiError("nope", "invalid_request_error", "invalid_api_key")).toEqual({
      error: {
        message: "nope",
        type: "invalid_request_error",
        code: "invalid_api_key",
        param: null,
      },
    });
  });

  it("defaults type and code", () => {
    expect(openaiError("boom")).toEqual({
      error: { message: "boom", type: "invalid_request_error", code: null, param: null },
    });
  });
});
