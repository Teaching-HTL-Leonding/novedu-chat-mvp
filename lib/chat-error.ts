// Turns a failed chat run into the sentence a student sees above the chat
// (`ChatErrorNotice` in app/module-chat.tsx, docs/chat.md "Run errors in the
// chat"). Pure and client-safe.
//
// CopilotKit reports a rejected run request as an Error whose message is
// `HTTP <status>: <response body>`. The /api/copilotkit route answers every
// rejection it authors with `{ error: "<readable sentence>" }` — written to be
// shown to the student (the code window, thread ownership, the student limits).
// So a 4xx body's `error` is shown VERBATIM; anything else — a 5xx, an in-band
// RUN_ERROR (agent- or provider-authored text that may quote the request), a
// network failure — gets the generic sentence, so no internal detail reaches
// the page.

export const GENERIC_CHAT_ERROR =
  "Something went wrong while answering. Please try again in a moment.";

const HTTP_ERROR = /^HTTP (\d{3}): ([\s\S]*)$/;

/** The student-facing sentence for a failed chat run. */
export function chatErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const match = HTTP_ERROR.exec(message);
  if (!match) return GENERIC_CHAT_ERROR;
  const status = Number(match[1]);
  if (status < 400 || status >= 500) return GENERIC_CHAT_ERROR;
  try {
    const body: unknown = JSON.parse(match[2] ?? "");
    const text =
      typeof body === "object" && body !== null ? (body as { error?: unknown }).error : undefined;
    return typeof text === "string" && text.trim() !== "" ? text : GENERIC_CHAT_ERROR;
  } catch {
    return GENERIC_CHAT_ERROR;
  }
}

/**
 * True when the run REQUEST was rejected by the route (a 4xx) — the server
 * then ran no agent and persisted nothing, so the student's unanswered
 * message exists only in the browser.
 */
export function isRejectedRunRequest(error: unknown): boolean {
  const match = HTTP_ERROR.exec(error instanceof Error ? error.message : "");
  const status = Number(match?.[1]);
  return status >= 400 && status < 500;
}

type ChatMessage = { role?: unknown; content?: unknown };

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (part): part is { type: "text"; text: string } =>
        typeof part === "object" &&
        part !== null &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string",
    )
    .map((part) => part.text)
    .join("\n");
}

/**
 * Splits off the trailing `user` messages no reply followed — the turn a
 * rejected request carried. A rejected message must leave the browser's
 * history: the route re-measures the whole unanswered tail on every run
 * (`trimToNewTurn`), so a message it once refused would make every later
 * attempt in that chat fail too. Only `user` messages are dropped; anything
 * else (an assistant reply, a frontend tool's result) ends the tail.
 * `unsentText` is what the student typed, so it can be copied back.
 */
export function splitUnansweredTurn<T extends ChatMessage>(
  messages: readonly T[],
): { kept: T[]; dropped: T[]; unsentText: string } {
  let start = messages.length;
  while (start > 0 && messages[start - 1]?.role === "user") start--;
  const dropped = messages.slice(start);
  return {
    kept: messages.slice(0, start),
    dropped,
    unsentText: dropped
      .map((m) => textOf(m.content))
      .filter((text) => text !== "")
      .join("\n\n"),
  };
}
