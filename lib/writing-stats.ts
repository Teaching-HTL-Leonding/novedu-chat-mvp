// Pure, client-safe text statistics for the writing module. The read-only
// `getCurrentText` frontend tool returns these alongside the draft so the
// assistant can check a prompt's length requirements (e.g. "at least 200 words",
// "max 1500 characters") against the live editor buffer. No I/O, no imports — it
// runs in the browser on every tool call.

export interface TextStats {
  /** Total characters, whitespace included (newlines, tabs and spaces count). */
  charactersIncludingWhitespace: number;
  /** Characters with every whitespace run removed — the "visible glyphs" count. */
  charactersExcludingWhitespace: number;
  /** Whitespace-delimited tokens (Markdown markup stays attached to its word). */
  words: number;
  /** Blocks of non-blank lines separated by one or more blank lines. */
  paragraphs: number;
}

// Count by Unicode code point (not UTF-16 unit) so a surrogate-pair glyph counts
// as one character; for the German prose this app is used for the two are
// identical, but code points avoid double-counting the occasional emoji.
function countCharacters(text: string): number {
  return [...text].length;
}

export function computeTextStats(text: string): TextStats {
  const trimmed = text.trim();

  // A paragraph is a maximal run of non-blank lines; any number of blank lines
  // (or whitespace-only lines, and CRLF or LF endings) separates two paragraphs.
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let paragraphs = 0;
  let inParagraph = false;
  for (const line of lines) {
    if (line.trim() === "") {
      inParagraph = false;
    } else if (!inParagraph) {
      paragraphs++;
      inParagraph = true;
    }
  }

  return {
    charactersIncludingWhitespace: countCharacters(text),
    charactersExcludingWhitespace: countCharacters(text.replace(/\s/g, "")),
    words: trimmed === "" ? 0 : trimmed.split(/\s+/).length,
    paragraphs,
  };
}
