import { describe, expect, test } from "vitest";
import { computeTextStats } from "@/lib/writing-stats";

describe("computeTextStats", () => {
  test("an empty string is all zeros", () => {
    expect(computeTextStats("")).toEqual({
      charactersIncludingWhitespace: 0,
      charactersExcludingWhitespace: 0,
      words: 0,
      paragraphs: 0,
    });
  });

  test("a whitespace-only string has no words or paragraphs but counts whitespace chars", () => {
    expect(computeTextStats("  \n\t  ")).toEqual({
      charactersIncludingWhitespace: 6,
      charactersExcludingWhitespace: 0,
      words: 0,
      paragraphs: 0,
    });
  });

  test("a single line of prose", () => {
    // "Hello world" — 11 chars incl. the space, 10 without, 2 words, 1 paragraph.
    expect(computeTextStats("Hello world")).toEqual({
      charactersIncludingWhitespace: 11,
      charactersExcludingWhitespace: 10,
      words: 2,
      paragraphs: 1,
    });
  });

  test("collapses runs of whitespace and ignores leading/trailing space for the word count", () => {
    const stats = computeTextStats("   the   quick brown   fox  ");
    expect(stats.words).toBe(4);
  });

  test("a single newline does not break a Markdown paragraph", () => {
    // One soft line break = same paragraph in Markdown.
    expect(computeTextStats("line one\nline two")).toMatchObject({
      paragraphs: 1,
      words: 4,
    });
  });

  test("blank lines separate paragraphs; any number of them counts as one break", () => {
    expect(computeTextStats("First para.\n\nSecond para.\n\n\n\nThird para.")).toMatchObject({
      paragraphs: 3,
    });
  });

  test("leading and trailing blank lines do not create empty paragraphs", () => {
    expect(computeTextStats("\n\n  \nOnly one\n\n  \n\n")).toMatchObject({
      paragraphs: 1,
    });
  });

  test("whitespace-only lines between text count as a paragraph break", () => {
    // The middle line has spaces only — still a blank line, so two paragraphs.
    expect(computeTextStats("Top\n   \nBottom")).toMatchObject({ paragraphs: 2 });
  });

  test("handles CRLF (Windows) line endings for paragraph breaks", () => {
    expect(computeTextStats("First.\r\n\r\nSecond.")).toMatchObject({ paragraphs: 2 });
  });

  test("counts German umlauts and ß as single characters", () => {
    // "Schöß" is 5 code points; no whitespace.
    expect(computeTextStats("Schöß")).toMatchObject({
      charactersIncludingWhitespace: 5,
      charactersExcludingWhitespace: 5,
      words: 1,
    });
  });

  test("counts a non-breaking space as whitespace", () => {
    // Built via fromCharCode so the source stays ASCII: the NBSP (U+00A0) is
    // whitespace, so it is excluded from the no-whitespace count and splits words.
    const stats = computeTextStats(`a${String.fromCharCode(160)}b`);
    expect(stats.charactersIncludingWhitespace).toBe(3);
    expect(stats.charactersExcludingWhitespace).toBe(2);
    expect(stats.words).toBe(2);
  });

  test("a surrogate-pair glyph counts as one character", () => {
    // "😀" is two UTF-16 units but one code point.
    expect(computeTextStats("😀")).toMatchObject({
      charactersIncludingWhitespace: 1,
      charactersExcludingWhitespace: 1,
      words: 1,
    });
  });

  test("Markdown markup stays attached to its word", () => {
    // "**bold** word" is two whitespace-delimited tokens.
    expect(computeTextStats("**bold** word")).toMatchObject({ words: 2 });
  });
});
