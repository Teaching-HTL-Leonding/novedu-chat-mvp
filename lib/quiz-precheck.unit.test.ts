import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildPrecheckRequest,
  mapPrecheckAnswer,
  PRECHECK_MIN_CONFIDENCE,
} from "@/lib/quiz-precheck";
import type { QuizVerdict } from "@/lib/quiz-types";
import type { QuizQuestion } from "@/lib/quiz-yaml";

// The pure pre-check core: what the classifier is asked, and how its answer
// becomes a hint. Plus the purity guard that keeps this module client-safe — the
// browser hook imports its constants, so a stray runtime import here would drag
// the YAML parser (or worse, the SDK) into the student's bundle.

const question: QuizQuestion = {
  id: "q1",
  question: "What is 2+2?",
  evaluation: "EVAL-CRITERIA: 4 is correct, 5 is not.",
};

describe("buildPrecheckRequest", () => {
  it("puts question, grading notes and the student's text into the state", () => {
    const request = buildPrecheckRequest(question, "4");
    expect(request.state).toEqual({
      question: "What is 2+2?",
      grading_notes: "EVAL-CRITERIA: 4 is correct, 5 is not.",
      student_answer: "4",
    });
  });

  it("prepends an imported question's sourcePreamble to the grading notes", () => {
    const request = buildPrecheckRequest(
      { ...question, sourcePreamble: "SOURCE-PREAMBLE chapter rules." },
      "4",
    );
    expect(request.state.grading_notes).toBe(
      "SOURCE-PREAMBLE chapter rules.\n\nEVAL-CRITERIA: 4 is correct, 5 is not.",
    );
  });

  it("never sends the quiz-level instructionsPreamble (irrelevant state costs accuracy)", () => {
    // The preamble is not even a parameter — this asserts it cannot sneak in via
    // some other field of the question either.
    const serialized = JSON.stringify(
      buildPrecheckRequest({ ...question, sourcePreamble: "SOURCE-PREAMBLE chapter rules." }, "4"),
    );
    expect(serialized).not.toContain("instructionsPreamble");
    expect(serialized).not.toContain("COMPOUND-PREAMBLE");
  });

  it("asks exactly one Choice question keyed by the QuizVerdict vocabulary", () => {
    const { questions } = buildPrecheckRequest(question, "4");
    expect(Object.keys(questions)).toEqual(["verdict"]);
    expect(questions.verdict.type).toBe("choice");
    expect(Object.keys(questions.verdict.criteria).sort()).toEqual([
      "correct",
      "incorrect",
      "partial",
    ] satisfies QuizVerdict[]);
    // The instructions name the state's fields — Jev reads literally.
    expect(questions.verdict.instructions).toContain("student_answer");
    expect(questions.verdict.instructions).toContain("grading_notes");
  });
});

describe("mapPrecheckAnswer", () => {
  it("keeps the chosen verdict at and above the confidence threshold", () => {
    expect(mapPrecheckAnswer("correct", PRECHECK_MIN_CONFIDENCE)).toEqual({ verdict: "correct" });
    expect(mapPrecheckAnswer("incorrect", 0.99)).toEqual({ verdict: "incorrect" });
  });

  it("degrades to `unsure` just below the threshold", () => {
    expect(mapPrecheckAnswer("correct", 0.49)).toEqual({ verdict: "unsure" });
    expect(mapPrecheckAnswer("partial", 0)).toEqual({ verdict: "unsure" });
  });

  it("returns the hint alone — no confidence reaches the client", () => {
    expect(Object.keys(mapPrecheckAnswer("partial", 0.8))).toEqual(["verdict"]);
  });
});

describe("client-safety invariant", () => {
  const source = readFileSync(join(__dirname, "quiz-precheck.ts"), "utf8");

  it("imports only types, and only from the two client-safe quiz modules", () => {
    // Import specifiers only, so the comments naming lib/llm and the SDK (they
    // explain WHY those are forbidden) do not trip the guard.
    const specifiers = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1] ?? "");
    expect(specifiers.sort()).toEqual(["@/lib/quiz-types", "@/lib/quiz-yaml"]);
    // Every import must be type-only — a value import of quiz-yaml would pull the
    // YAML parser into the browser bundle.
    const valueImports = [...source.matchAll(/^import\s+(?!type\b)[^\n]*from/gm)];
    expect(valueImports).toEqual([]);
  });

  it("carries no 'use server' directive", () => {
    expect(source).not.toMatch(/^\s*["']use server["']/m);
  });
});
