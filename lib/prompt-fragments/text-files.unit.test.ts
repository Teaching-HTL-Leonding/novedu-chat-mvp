import { describe, expect, it } from "vitest";
import { countLines, sliceLines } from "./text-files";

// The pure line-range semantics shared by the consistency bounds-check and the render
// resolver. No network, no Handlebars — just string slicing. These tests pin the two
// subtle rules the design hangs on: a trailing newline is NOT a phantom extra line, and
// `to` beyond EOF clamps (the runtime's graceful-degradation contract) while callers own
// the `from` lower bound.

describe("countLines", () => {
  it("counts an empty body as zero lines", () => {
    expect(countLines("")).toBe(0);
  });

  it("counts a single line with no trailing newline", () => {
    expect(countLines("only")).toBe(1);
  });

  it("does NOT count the trailing newline of a conventional file as an extra line", () => {
    expect(countLines("only\n")).toBe(1);
    expect(countLines("a\nb\n")).toBe(2);
  });

  it("counts an interior blank line", () => {
    expect(countLines("a\n\nb")).toBe(3);
  });

  it("counts a trailing blank line (two newlines) as a real final empty line", () => {
    // "a\n\n" → drop ONE trailing empty element → ["a", ""] → 2 lines.
    expect(countLines("a\n\n")).toBe(2);
  });

  it("counts a body without a trailing newline fully", () => {
    expect(countLines("a\nb\nc")).toBe(3);
  });
});

describe("sliceLines", () => {
  const BODY = "L1\nL2\nL3\nL4\nL5\n"; // 5 lines, conventional trailing newline

  it("slices a closed [from, to] range and re-joins without appending a newline", () => {
    expect(sliceLines(BODY, 2, 4)).toBe("L2\nL3\nL4");
  });

  it("from alone means 'that line to end of file'", () => {
    expect(sliceLines(BODY, 3)).toBe("L3\nL4\nL5");
  });

  it("to alone means 'line 1 to that line'", () => {
    expect(sliceLines(BODY, undefined, 2)).toBe("L1\nL2");
  });

  it("slices a single line for from === to", () => {
    expect(sliceLines(BODY, 3, 3)).toBe("L3");
  });

  it("clamps a `to` beyond EOF to end-of-file (runtime graceful degradation)", () => {
    expect(sliceLines(BODY, 4, 99)).toBe("L4\nL5");
  });

  it("with no range re-joins every logical line, dropping the trailing newline", () => {
    // NB: the VERBATIM (byte-identical) no-range path lives in load.ts and bypasses this;
    // sliceLines itself always works on logical lines, so the trailing newline is gone.
    expect(sliceLines(BODY)).toBe("L1\nL2\nL3\nL4\nL5");
  });

  it("returns an empty string for an empty body", () => {
    expect(sliceLines("", 1)).toBe("");
    expect(sliceLines("")).toBe("");
  });

  it("slices a single-line body with no trailing newline", () => {
    expect(sliceLines("solo", 1, 1)).toBe("solo");
    expect(sliceLines("solo", 1)).toBe("solo");
  });
});
