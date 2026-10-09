import type { TutorThreadSummary } from "@/lib/tutor-history-types";

// The one-line preview of a conversation in "Previous conversations": the first
// student message, whitespace collapsed and cut at a word boundary. Plain text —
// the list shows it as is, no Markdown rendering. Pure.

/** Longest preview, in characters, before the `…`. */
export const PREVIEW_MAX_CHARS = 200;

export function buildPreview({
  text,
  hasFile,
}: {
  /** The first user message's concatenated text parts (null when it had none). */
  text: string | null;
  /** Whether that message carried a photo. */
  hasFile: boolean;
}): TutorThreadSummary["preview"] {
  const collapsed = (text ?? "").replace(/\s+/g, " ").trim();
  if (collapsed === "") return hasFile ? { kind: "photo" } : { kind: "text", text: "" };
  if (collapsed.length <= PREVIEW_MAX_CHARS) return { kind: "text", text: collapsed };

  const head = collapsed.slice(0, PREVIEW_MAX_CHARS);
  // Cut on the last word boundary; a single word longer than the limit is cut hard.
  const lastSpace = head.lastIndexOf(" ");
  const cut = lastSpace > 0 ? head.slice(0, lastSpace) : head;
  return { kind: "text", text: `${cut}…` };
}
