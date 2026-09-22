import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  immediateFeedbackConfigured,
  immediateFeedbackMisconfigured,
} from "@/lib/quiz-immediate-feedback";

// Pure env reading (like the openrouter-endpoint tests): the gate is the
// case-insensitive flag AND the OpenRouter key, with the "flag without key" case
// split out so a boot warning can tell an operator why nothing happens.

beforeEach(() => {
  vi.unstubAllEnvs();
});

/** The full flag matrix against a present / absent key. */
const FLAGS: Array<[label: string, value: string | undefined, meansOn: boolean]> = [
  ["true", "true", true],
  ["TRUE", "TRUE", true],
  ["padded true", "  true  ", true],
  ["yes", "yes", false],
  ["1", "1", false],
  ["false", "false", false],
  ["unset", undefined, false],
];

describe("immediateFeedbackConfigured", () => {
  it.each(FLAGS)("with the key present, %s → %s", (_label, value, meansOn) => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test");
    vi.stubEnv("QUIZ_IMMEDIATE_FEEDBACK", value);
    expect(immediateFeedbackConfigured()).toBe(meansOn);
  });

  it.each(FLAGS)("without the key, %s is off regardless", (_label, value) => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("QUIZ_IMMEDIATE_FEEDBACK", value);
    expect(immediateFeedbackConfigured()).toBe(false);
  });
});

describe("immediateFeedbackMisconfigured", () => {
  it("is true only for a meant flag without the key", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("QUIZ_IMMEDIATE_FEEDBACK", "TRUE");
    expect(immediateFeedbackMisconfigured()).toBe(true);
    expect(immediateFeedbackConfigured()).toBe(false);
  });

  it("is false once the key is there (the feature simply runs)", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test");
    vi.stubEnv("QUIZ_IMMEDIATE_FEEDBACK", "true");
    expect(immediateFeedbackMisconfigured()).toBe(false);
  });

  it.each(FLAGS.filter(([, , meansOn]) => !meansOn))(
    "stays quiet for %s — nothing was asked for",
    (_label, value) => {
      vi.stubEnv("OPENROUTER_API_KEY", "");
      vi.stubEnv("QUIZ_IMMEDIATE_FEEDBACK", value);
      expect(immediateFeedbackMisconfigured()).toBe(false);
    },
  );
});
