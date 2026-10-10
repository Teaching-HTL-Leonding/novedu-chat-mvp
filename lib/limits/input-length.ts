// Measures what a student TYPED in one chat turn, for the input-length limit
// (docs/chat.md). Pure, so it unit-tests without the route.
//
// Counts the text of `user` messages only:
//  - images (`binary`/`image` parts) are bounded separately by the route's body
//    cap and the client's image normalization, so they never count here;
//  - `tool` messages are NOT typed by the student — the writing module's
//    `getCurrentText` frontend tool returns the whole essay that way, and the
//    limit must never block a student from asking about their own text.

function textOf(content: unknown): number {
  if (typeof content === "string") return content.length;
  if (!Array.isArray(content)) return 0;
  let length = 0;
  for (const part of content) {
    if (
      typeof part === "object" &&
      part !== null &&
      (part as { type?: unknown }).type === "text" &&
      typeof (part as { text?: unknown }).text === "string"
    ) {
      length += (part as { text: string }).text.length;
    }
  }
  return length;
}

/** Total text characters across the `user` messages of an AG-UI message list. */
export function userTextLength(messages: ReadonlyArray<unknown>): number {
  let length = 0;
  for (const message of messages) {
    if (typeof message !== "object" || message === null) continue;
    const { role, content } = message as { role?: unknown; content?: unknown };
    if (role === "user") length += textOf(content);
  }
  return length;
}
