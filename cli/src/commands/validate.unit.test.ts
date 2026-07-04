// @vitest-environment node
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runValidate } from "./validate";

// In-process, no network: drive the real validate handler (real loader + real
// file fetcher) over the committed fixtures in `tutors/` / `quizzes/` / `writings/`.
// Runs in CI.
const tutorsDir = fileURLToPath(new URL("../../../tutors/", import.meta.url));
const quizzesDir = fileURLToPath(new URL("../../../quizzes/", import.meta.url));
const writingsDir = fileURLToPath(new URL("../../../writings/", import.meta.url));
const codingDir = fileURLToPath(new URL("../../../coding/", import.meta.url));

describe("runValidate — tutors (local files)", () => {
  it("accepts a valid tutor and reports its model", async () => {
    const outcome = await runValidate(`${tutorsDir}simple-tutor.yaml`, "tutor");

    expect(outcome.kind).toBe("tutor");
    expect(outcome.result.ok).toBe(true);
    if (outcome.kind === "tutor" && outcome.result.ok) {
      expect(outcome.result.model).toBeTruthy();
      expect(outcome.result.prompt.length).toBeGreaterThan(0);
    }
  });

  it("rejects a broken tutor with structured errors", async () => {
    const outcome = await runValidate(`${tutorsDir}broken-tutor.yaml`, "tutor");

    expect(outcome.result.ok).toBe(false);
    if (!outcome.result.ok) {
      expect(outcome.result.errors.length).toBeGreaterThan(0);
      expect(outcome.result.errors[0]?.code).toBeTruthy();
    }
  });

  it("reports a missing file as a FETCH_FAILED error (no throw)", async () => {
    const outcome = await runValidate(`${tutorsDir}does-not-exist.yaml`, "tutor");

    expect(outcome.result.ok).toBe(false);
    if (!outcome.result.ok) {
      expect(outcome.result.errors[0]?.code).toBe("FETCH_FAILED");
    }
  });
});

describe("runValidate — fragment libraries (local files)", () => {
  it("accepts a valid fragment file and lists its fragments", async () => {
    const outcome = await runValidate(`${tutorsDir}simple-fragments.yaml`, "fragment");

    expect(outcome.kind).toBe("fragment");
    expect(outcome.result.ok).toBe(true);
    if (outcome.kind === "fragment" && outcome.result.ok) {
      expect(outcome.result.fragmentFileId).toBe("simple-fragments");
      expect(outcome.result.fragmentIds.length).toBeGreaterThan(0);
    }
  });

  it("rejects a fragment file whose template uses an undeclared variable", async () => {
    const outcome = await runValidate(`${tutorsDir}broken-template-fragments.yaml`, "fragment");

    expect(outcome.result.ok).toBe(false);
    if (!outcome.result.ok) {
      expect(outcome.result.errors.some((e) => e.code === "FRAGMENT_TEMPLATE_ERROR")).toBe(true);
    }
  });
});

describe("runValidate — quizzes (local files)", () => {
  it("accepts a valid quiz and reports its model + question count", async () => {
    const outcome = await runValidate(`${quizzesDir}sample-quiz.yaml`, "quiz");

    expect(outcome.kind).toBe("quiz");
    expect(outcome.result.ok).toBe(true);
    if (outcome.kind === "quiz" && outcome.result.ok) {
      expect(outcome.result.model).toBeTruthy();
      expect(outcome.result.questionCount).toBeGreaterThan(0);
    }
  });

  it("rejects the committed broken quiz with a QUIZ_SCHEMA_ERROR", async () => {
    const outcome = await runValidate(`${quizzesDir}broken-quiz.yaml`, "quiz");

    expect(outcome.result.ok).toBe(false);
    if (!outcome.result.ok) {
      expect(outcome.result.errors[0]?.code).toBe("QUIZ_SCHEMA_ERROR");
    }
  });

  it("reports a missing file as a FETCH_FAILED error (no throw)", async () => {
    const outcome = await runValidate(`${quizzesDir}does-not-exist.yaml`, "quiz");

    expect(outcome.result.ok).toBe(false);
    if (!outcome.result.ok) {
      expect(outcome.result.errors[0]?.code).toBe("FETCH_FAILED");
    }
  });
});

describe("runValidate — writing activities (local files)", () => {
  it("accepts a valid writing activity and reports its model", async () => {
    const outcome = await runValidate(`${writingsDir}human-animal-short-story.yaml`, "writing");

    expect(outcome.kind).toBe("writing");
    expect(outcome.result.ok).toBe(true);
    if (outcome.kind === "writing" && outcome.result.ok) {
      expect(outcome.result.model).toBeTruthy();
    }
  });

  it("rejects the committed broken writing activity with a WRITING_SCHEMA_ERROR", async () => {
    const outcome = await runValidate(`${writingsDir}broken-writing.yaml`, "writing");

    expect(outcome.result.ok).toBe(false);
    if (!outcome.result.ok) {
      expect(outcome.result.errors[0]?.code).toBe("WRITING_SCHEMA_ERROR");
    }
  });
});

describe("runValidate — coding activities (local files)", () => {
  it("accepts a valid coding activity and reports its model", async () => {
    const outcome = await runValidate(`${codingDir}beginner-typescript.yaml`, "coding");

    expect(outcome.kind).toBe("coding");
    expect(outcome.result.ok).toBe(true);
    if (outcome.kind === "coding" && outcome.result.ok) {
      expect(outcome.result.model).toBeTruthy();
      expect(outcome.result.codingId).toBe("beginner-typescript");
    }
  });

  it("rejects the committed broken coding activity with a CODING_SCHEMA_ERROR", async () => {
    const outcome = await runValidate(`${codingDir}broken-coding.yaml`, "coding");

    expect(outcome.result.ok).toBe(false);
    if (!outcome.result.ok) {
      expect(outcome.result.errors[0]?.code).toBe("CODING_SCHEMA_ERROR");
    }
  });

  it("reports a missing file as a FETCH_FAILED error (no throw)", async () => {
    const outcome = await runValidate(`${codingDir}does-not-exist.yaml`, "coding");

    expect(outcome.result.ok).toBe(false);
    if (!outcome.result.ok) {
      expect(outcome.result.errors[0]?.code).toBe("FETCH_FAILED");
    }
  });
});
