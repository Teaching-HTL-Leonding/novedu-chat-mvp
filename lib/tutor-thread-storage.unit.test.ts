// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAllTutorThreads,
  readTutorThread,
  removeTutorThread,
  writeTutorThread,
} from "@/lib/tutor-thread-storage";

// The tab's memory of its current tutor thread. Everything is best-effort: a
// broken storage turns the feature off, never breaks the chat.

const PAIR = { threadId: "t-1", threadToken: "abc123" };

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("tutor thread storage", () => {
  it("round-trips a pair per code", () => {
    writeTutorThread("code-a", PAIR);
    writeTutorThread("code-b", { threadId: "t-2", threadToken: "def" });
    expect(readTutorThread("code-a")).toEqual(PAIR);
    expect(readTutorThread("code-b")).toEqual({ threadId: "t-2", threadToken: "def" });
    expect(window.sessionStorage.getItem("novedu.tutorThread.code-a")).toBe(JSON.stringify(PAIR));
  });

  it("returns null for a code with nothing stored", () => {
    expect(readTutorThread("nothing")).toBeNull();
  });

  it("removes one code's pair", () => {
    writeTutorThread("code-a", PAIR);
    removeTutorThread("code-a");
    expect(readTutorThread("code-a")).toBeNull();
  });

  it.each([
    ["not JSON", "{oops"],
    ["the wrong shape", JSON.stringify({ threadId: 1, threadToken: "x" })],
    ["null", "null"],
  ])("treats %s as absent and removes it", (_label, raw) => {
    window.sessionStorage.setItem("novedu.tutorThread.code-a", raw);
    expect(readTutorThread("code-a")).toBeNull();
    expect(window.sessionStorage.getItem("novedu.tutorThread.code-a")).toBeNull();
  });

  it("stores only the two fields", () => {
    writeTutorThread("code-a", { ...PAIR, restoring: true } as typeof PAIR);
    expect(JSON.parse(window.sessionStorage.getItem("novedu.tutorThread.code-a") ?? "")).toEqual(
      PAIR,
    );
  });

  it("tolerates a throwing storage (private mode, blocked site data)", () => {
    const boom = () => {
      throw new DOMException("blocked", "SecurityError");
    };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(boom);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(boom);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(boom);
    vi.spyOn(Storage.prototype, "key").mockImplementation(boom);

    expect(() => writeTutorThread("code-a", PAIR)).not.toThrow();
    expect(readTutorThread("code-a")).toBeNull();
    expect(() => removeTutorThread("code-a")).not.toThrow();
    expect(() => clearAllTutorThreads()).not.toThrow();
  });

  it("clearAllTutorThreads removes only its own prefix", () => {
    writeTutorThread("code-a", PAIR);
    writeTutorThread("code-b", PAIR);
    window.sessionStorage.setItem("someone.else", "keep");
    window.sessionStorage.setItem("novedu.other", "keep");

    clearAllTutorThreads();

    expect(readTutorThread("code-a")).toBeNull();
    expect(readTutorThread("code-b")).toBeNull();
    expect(window.sessionStorage.getItem("someone.else")).toBe("keep");
    expect(window.sessionStorage.getItem("novedu.other")).toBe("keep");
  });
});
