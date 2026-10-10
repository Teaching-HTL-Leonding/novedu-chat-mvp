// The fake LLM's whole behaviour as one pure function: an OpenAI chat-completions
// request in, an aimock response object out. `fake-llm/server.mjs` registers it
// as aimock's single catch-all fixture, so everything here is unit-testable
// without a server (fake-llm/markers.unit.test.ts) — aimock's matching and wire
// format are not ours to re-test.
//
// Behaviour is driven by markers in the LAST user message, never by a spec's
// wording. Rules are evaluated in order; the first match wins (docs/testing.md,
// "Fake LLM"):
//
//   1. model id contains `no-such-model`      → HTTP 404 "model not found"
//   2. grader request + `[grade:<verdict>]`   → that verdict
//   3. grader request without a marker         → `correct`
//   4. any other `json_schema` request         → HTTP 400 (no fixture)
//   5. a tool result after the last user msg   → echo of the tool result
//   6. `[tool:<name>]` / `[tool:<name> <json>]` → one call to that tool
//   7. `[reasoning:<text>]`                    → that reasoning + the default reply
//   8. `[reply:<text>]`                        → exactly that text
//   9. anything else                           → the default reply (an echo)
//
// No imports: spec 3 packages this directory as the fake's container image.

const ECHO_LENGTH = 80;

const GRADE_MARKER = /\[grade:(correct|partial|incorrect)\]/;
// The JSON is greedy up to the closing `}]`, so arguments may contain `]`.
const TOOL_MARKER = /\[tool:([A-Za-z0-9_-]+)(?:\s+(\{.*\}))?\]/s;
const REASONING_MARKER = /\[reasoning:([^\]]*)\]/;
const REPLY_MARKER = /\[reply:([^\]]*)\]/;

/** The text of a message's content, whether a plain string or multimodal parts. */
function textOf(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => part.text ?? "").join("");
  return "";
}

/** The default reply: says openly that it is fake, and echoes what was asked. */
export function defaultReply(userText) {
  return `This reply comes from Novedu's fake LLM, not a real model. You wrote: ${userText.slice(0, ECHO_LENGTH)}`;
}

/**
 * The quiz grader's request: structured output whose schema has a top-level
 * `result` property (`QUIZ_VERDICT_SCHEMA` in lib/quiz-verdict-schema.ts).
 * Detected by schema, not by prompt wording.
 */
function isGraderRequest(responseFormat) {
  return responseFormat?.json_schema?.schema?.properties?.result !== undefined;
}

/** The `[tool:…]` marker's tool call, or undefined when absent or malformed. */
function toolCallFrom(text) {
  const match = TOOL_MARKER.exec(text);
  if (!match) return undefined;
  const [, name, args = "{}"] = match;
  try {
    JSON.parse(args);
  } catch {
    return undefined;
  }
  return { name, arguments: args };
}

function verdict(result) {
  return { content: JSON.stringify({ result, feedback: `Fake LLM verdict: ${result}.` }) };
}

/** Maps one chat-completions request to the aimock response the fake serves. */
export function fakeReply(request) {
  const messages = request.messages ?? [];
  const lastUserIndex = messages.findLastIndex((m) => m.role === "user");
  const userText = lastUserIndex >= 0 ? textOf(messages[lastUserIndex].content) : "";

  // 1. A model the fake pretends not to serve — a provider-side failed turn.
  if (String(request.model ?? "").includes("no-such-model")) {
    return {
      status: 404,
      error: { message: "model not found", type: "invalid_request_error", code: "model_not_found" },
    };
  }

  // 2.–4. Structured output: only the quiz grader has a fixture.
  if (request.response_format?.type === "json_schema") {
    if (isGraderRequest(request.response_format)) {
      return verdict(GRADE_MARKER.exec(userText)?.[1] ?? "correct");
    }
    return {
      status: 400,
      error: {
        message: "fake LLM: no fixture for this structured request",
        type: "invalid_request_error",
      },
    };
  }

  // 5. The second leg of a tool round-trip: echo what the tool returned.
  const toolResult = messages.slice(lastUserIndex + 1).findLast((m) => m.role === "tool");
  if (toolResult) {
    return { content: `Fake LLM received the tool result: ${textOf(toolResult.content)}` };
  }

  // 6. The first leg: call the named tool.
  const toolCall = toolCallFrom(userText);
  if (toolCall) return { toolCalls: [toolCall] };

  // 7. A thinking model's turn: reasoning first, then the default reply.
  const reasoning = REASONING_MARKER.exec(userText)?.[1];
  if (reasoning !== undefined) return { reasoning, content: defaultReply(userText) };

  // 8. An exact reply.
  const reply = REPLY_MARKER.exec(userText)?.[1];
  if (reply !== undefined) return { content: reply };

  // 9. The default echo.
  return { content: defaultReply(userText) };
}
