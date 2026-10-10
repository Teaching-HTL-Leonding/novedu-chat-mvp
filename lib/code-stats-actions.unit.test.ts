import { describe, expect, it, vi } from "vitest";

// `loadConversationTranscript` is a "use server" action returning a student's
// conversation messages. Its only gate is `requireEffectiveTeacher()`, so the
// test pins that a refused gate stops the read and an admitted one forwards
// (code, threadId) to the store.

const requireEffectiveTeacher = vi.hoisted(() => vi.fn());
const getConversationMessages = vi.hoisted(() => vi.fn());

vi.mock("@/lib/student-mode", () => ({ requireEffectiveTeacher }));
vi.mock("@/lib/code-stats-store", () => ({ getConversationMessages }));

import { loadConversationTranscript } from "@/lib/code-stats-actions";

describe("loadConversationTranscript", () => {
  it("rejects without reading messages when the teacher gate refuses", async () => {
    requireEffectiveTeacher.mockRejectedValueOnce(new Error("forbidden"));
    await expect(loadConversationTranscript("a1b2c3d4e5", "t1")).rejects.toThrow("forbidden");
    expect(getConversationMessages).not.toHaveBeenCalled();
  });

  it("forwards (code, threadId) to the store and returns its messages once the gate resolves", async () => {
    const messages = [{ id: "m1", role: "user", content: "Hi" }];
    requireEffectiveTeacher.mockResolvedValueOnce(undefined);
    getConversationMessages.mockResolvedValueOnce(messages);
    await expect(loadConversationTranscript("a1b2c3d4e5", "t1")).resolves.toBe(messages);
    expect(getConversationMessages).toHaveBeenCalledWith("a1b2c3d4e5", "t1");
  });
});
