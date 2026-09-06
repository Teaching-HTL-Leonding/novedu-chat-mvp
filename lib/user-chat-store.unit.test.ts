import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadAndBuildTutorPrompt: vi.fn(),
  loadQuiz: vi.fn(),
  insertValues: vi.fn(),
  onConflictDoNothing: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        mocks.insertValues(values);
        return { onConflictDoNothing: mocks.onConflictDoNothing };
      },
    }),
  }),
}));
vi.mock("@/lib/tutors", () => ({
  loadAndBuildTutorPrompt: mocks.loadAndBuildTutorPrompt,
}));
vi.mock("@/lib/prompt-fragments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/prompt-fragments")>()),
  defaultFetcher: vi.fn(),
}));
vi.mock("@/lib/quiz-fetch", () => ({ loadQuiz: mocks.loadQuiz }));

import { recordUserChat, resetUserChatDedupeCacheForTests } from "@/lib/user-chat-store";

const CODE = "a1b2c3d4e5";
const THREAD = "0f8fad5b-d9cb-469f-a165-70867728950e";
const USER = "student-sub-1";
const FILE_URL = "https://example.com/tutor.yaml";

beforeEach(() => {
  vi.clearAllMocks();
  resetUserChatDedupeCacheForTests();
  mocks.onConflictDoNothing.mockResolvedValue(undefined);
  // Default tutor/quiz: anonymous (the YAML default) — nothing must be stored.
  mocks.loadAndBuildTutorPrompt.mockResolvedValue({ ok: true, anonymous: true });
  mocks.loadQuiz.mockResolvedValue({ ok: true, quiz: { anonymous: true } });
});

describe("recordUserChat — anonymous gate (tutor)", () => {
  it("stores NOTHING for an anonymous tutor (the default)", async () => {
    await recordUserChat(CODE, THREAD, USER, FILE_URL, "tutor");
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });

  it("stores the user↔chat link when the tutor opts out (anonymous: false)", async () => {
    mocks.loadAndBuildTutorPrompt.mockResolvedValue({ ok: true, anonymous: false });
    await recordUserChat(CODE, THREAD, USER, FILE_URL, "tutor");
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: THREAD, code: CODE, userId: USER }),
    );
  });

  it("stays anonymous when the tutor YAML cannot be loaded (privacy-safe default)", async () => {
    mocks.loadAndBuildTutorPrompt.mockResolvedValue({ ok: false, errors: [], warnings: [] });
    await recordUserChat(CODE, THREAD, USER, FILE_URL, "tutor");
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });

  it("does NOT cache a failed YAML load — attribution recovers on the next call", async () => {
    mocks.loadAndBuildTutorPrompt.mockResolvedValueOnce({ ok: false, errors: [], warnings: [] });
    await recordUserChat(CODE, THREAD, USER, FILE_URL, "tutor"); // transient failure, no row
    mocks.loadAndBuildTutorPrompt.mockResolvedValue({ ok: true, anonymous: false });
    await recordUserChat(CODE, THREAD, USER, FILE_URL, "tutor"); // host recovered
    expect(mocks.loadAndBuildTutorPrompt).toHaveBeenCalledTimes(2);
    expect(mocks.insertValues).toHaveBeenCalledTimes(1);
  });

  it("does NOT cache a throwing YAML load either", async () => {
    mocks.loadAndBuildTutorPrompt.mockRejectedValueOnce(new Error("ECONNRESET"));
    await recordUserChat(CODE, THREAD, USER, FILE_URL, "tutor"); // never throws
    mocks.loadAndBuildTutorPrompt.mockResolvedValue({ ok: true, anonymous: false });
    await recordUserChat(CODE, THREAD, USER, FILE_URL, "tutor");
    expect(mocks.insertValues).toHaveBeenCalledTimes(1);
  });
});

describe("recordUserChat — anonymous gate (quiz)", () => {
  it("reads the live anonymous flag via loadQuiz; stores nothing when anonymous", async () => {
    await recordUserChat(CODE, THREAD, USER, FILE_URL, "quiz");
    expect(mocks.loadQuiz).toHaveBeenCalledWith(FILE_URL);
    expect(mocks.loadAndBuildTutorPrompt).not.toHaveBeenCalled();
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });

  it("stores the link (with the real code) when the quiz opts out", async () => {
    mocks.loadQuiz.mockResolvedValue({ ok: true, quiz: { anonymous: false } });
    await recordUserChat(CODE, THREAD, USER, FILE_URL, "quiz");
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: THREAD, code: CODE, userId: USER }),
    );
  });
});

describe("recordUserChat — dedupe & robustness", () => {
  it("does all work (YAML fetch, insert) only once per thread", async () => {
    mocks.loadAndBuildTutorPrompt.mockResolvedValue({ ok: true, anonymous: false });
    await recordUserChat(CODE, THREAD, USER, FILE_URL, "tutor");
    await recordUserChat(CODE, THREAD, USER, FILE_URL, "tutor");
    expect(mocks.loadAndBuildTutorPrompt).toHaveBeenCalledTimes(1);
    expect(mocks.insertValues).toHaveBeenCalledTimes(1);
  });

  it("caches the negative decision for anonymous tutors too", async () => {
    await recordUserChat(CODE, THREAD, USER, FILE_URL, "tutor");
    await recordUserChat(CODE, THREAD, USER, FILE_URL, "tutor");
    expect(mocks.loadAndBuildTutorPrompt).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed thread ids without touching YAML or database", async () => {
    await recordUserChat(CODE, "../../etc/passwd", USER, FILE_URL, "tutor");
    expect(mocks.loadAndBuildTutorPrompt).not.toHaveBeenCalled();
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });

  it("conflict is a silent success (a concurrent insert already stored the row)", async () => {
    mocks.loadAndBuildTutorPrompt.mockResolvedValue({ ok: true, anonymous: false });
    await recordUserChat(CODE, THREAD, USER, FILE_URL, "tutor");
    expect(mocks.onConflictDoNothing).toHaveBeenCalledWith(
      expect.objectContaining({ target: expect.anything() }),
    );
    // Cached as handled: the next call does nothing.
    await recordUserChat(CODE, THREAD, USER, FILE_URL, "tutor");
    expect(mocks.insertValues).toHaveBeenCalledTimes(1);
  });

  it("retries after a transient database error (decision not cached)", async () => {
    mocks.loadAndBuildTutorPrompt.mockResolvedValue({ ok: true, anonymous: false });
    mocks.onConflictDoNothing.mockRejectedValueOnce(new Error("connection lost"));
    await recordUserChat(CODE, THREAD, USER, FILE_URL, "tutor"); // fails, never throws
    await recordUserChat(CODE, THREAD, USER, FILE_URL, "tutor"); // retried
    expect(mocks.insertValues).toHaveBeenCalledTimes(2);
  });
});
