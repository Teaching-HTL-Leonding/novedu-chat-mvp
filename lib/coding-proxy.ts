// Pure helpers for the OpenAI-compatible coding proxy. No I/O, so they unit-test
// hermetically. The route handler (app/api/coding/v1/chat/completions) wires these
// to checkCode + loadCoding + the SCCH fetch.

/** OpenAI-style error envelope, e.g. `{ error: { message, type, code, param } }`. */
export interface OpenAiErrorBody {
  error: { message: string; type: string; code: string | null; param: string | null };
}

export function openaiError(
  message: string,
  type = "invalid_request_error",
  code: string | null = null,
): OpenAiErrorBody {
  return { error: { message, type, code, param: null } };
}

/**
 * Extracts the code (bearer key) from an Authorization header value. Accepts
 * "Bearer <token>" (case-insensitive scheme) and returns the token VERBATIM — the
 * code IS the key, so nothing is stripped (a code may legitimately start with any
 * `[a-z0-9-]` sequence, including "sk-"). Returns null when absent or empty.
 * Validity of the code itself is left to `checkCode`.
 */
export function parseBearerKey(headerValue: string | null): string | null {
  if (!headerValue) return null;
  const match = /^Bearer\s+(.+)$/i.exec(headerValue.trim());
  if (!match) return null;
  const token = (match[1] ?? "").trim();
  return token === "" ? null : token;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Appends the teacher's instructions to the END of an existing system-message
 * `content`, handling both the string form and OpenAI's content-parts array form.
 * Falls back to the instructions alone when there is no usable existing content.
 */
function appendInstructions(existing: unknown, instructions: string): unknown {
  if (typeof existing === "string") {
    return existing.trim() === "" ? instructions : `${existing}\n\n${instructions}`;
  }
  if (Array.isArray(existing)) {
    return [...existing, { type: "text", text: instructions }];
  }
  return instructions;
}

/**
 * Builds the upstream Chat Completions body from the client's body: PIN the model and
 * fold in the teacher's system prompt. The teacher's instructions are appended to the
 * END of the client's existing system message, so the teacher has the final word and
 * takes precedence over the coding tool's own prompt; if the client sent no system
 * message, a leading one carrying only the teacher's instructions is added. Everything
 * else (messages, tools, tool_choice, temperature, stream, …) passes through verbatim,
 * so client-side tools and streaming are all preserved.
 */
export function buildUpstreamChatBody(
  clientBody: Record<string, unknown>,
  opts: { instructions: string; model: string },
): Record<string, unknown> {
  const clientMessages = Array.isArray(clientBody.messages) ? clientBody.messages : [];
  const systemIndex = clientMessages.findIndex((m) => isRecord(m) && m.role === "system");

  let messages: unknown[];
  if (systemIndex === -1) {
    // No system message from the client — add one carrying just the teacher's prompt.
    messages = [{ role: "system", content: opts.instructions }, ...clientMessages];
  } else {
    // Append the teacher's prompt to the end of the client's own system message.
    const existing = clientMessages[systemIndex] as Record<string, unknown>;
    messages = [...clientMessages];
    messages[systemIndex] = {
      ...existing,
      content: appendInstructions(existing.content, opts.instructions),
    };
  }

  return { ...clientBody, model: opts.model, messages };
}
