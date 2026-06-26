// @vitest-environment node

import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `ConversationStats` is the shared per-code detail body (tutor/quiz, and writing's
// anonymous fallback): the summary tiles + the conversation table. The
// privacy-relevant invariant lives here — per-student data (the "Students" tile and
// the "Student" column) appears ONLY for a non-anonymous code, and the frozen
// `anonymous` flag is forwarded to the store so it redacts ids at the data layer.
// I/O is mocked; the component is invoked directly. No DB, runs in CI.

const getCodeStats = vi.hoisted(() => vi.fn());

vi.mock("@/lib/code-stats-store", () => ({ getCodeStats }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import type { CodeEntry } from "@/lib/code-store";
import { ConversationStats } from "./conversation-stats";

const CODE = "a1b2c3d4e5";

function entry(overrides: Record<string, unknown> = {}) {
  return {
    code: CODE,
    module: "tutor",
    fileUrl: "https://example.com/t.yaml",
    note: "My Class",
    anonymous: true,
    ...overrides,
  } as unknown as CodeEntry;
}

const interaction = {
  threadId: "th1",
  firstAt: new Date("2026-06-12T10:00:00Z"),
  lastAt: new Date("2026-06-12T10:05:00Z"),
  userMessageCount: 3,
  userId: "student-sub-1",
  userName: null as string | null,
};

async function render(e = entry()) {
  return renderToStaticMarkup(await ConversationStats({ entry: e }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("error + empty", () => {
  it("shows a transient notice when stats fail to load", async () => {
    getCodeStats.mockResolvedValue(undefined);
    expect(await render()).toContain("Stats temporarily unavailable");
  });

  it("notes when a code has no interactions yet", async () => {
    getCodeStats.mockResolvedValue({ conversations: 0, studentCount: 0, interactions: [] });
    expect(await render()).toContain("Nothing yet");
  });
});

describe("anonymous code", () => {
  beforeEach(() => {
    getCodeStats.mockResolvedValue({
      conversations: 1,
      studentCount: 0,
      interactions: [interaction],
    });
  });

  it("shows the count + interaction but no per-student data", async () => {
    const html = await render(entry({ anonymous: true }));
    expect(html).toContain("Conversations"); // tutor count label
    expect(html).toContain(">3<"); // user-message count
    expect(html).toContain(`/codes/${CODE}/c/th1`); // View link
    expect(html).not.toContain("Students");
    expect(html).not.toContain(">Student<");
    expect(html).not.toContain("student-sub-1");
  });

  it("forwards the frozen anonymous flag so the store redacts ids", async () => {
    await render(entry({ anonymous: true }));
    expect(getCodeStats).toHaveBeenCalledWith(CODE, true);
  });
});

describe("non-anonymous code", () => {
  beforeEach(() => {
    getCodeStats.mockResolvedValue({
      conversations: 1,
      studentCount: 1,
      interactions: [interaction],
    });
  });

  it("shows the Students tile, the Student column, and the user id (no name recorded)", async () => {
    const html = await render(entry({ anonymous: false }));
    expect(html).toContain("Students");
    expect(html).toContain(">Student<");
    expect(html).toContain("student-sub-1");
  });

  it("shows the resolved display name when present, with the oid kept as the hover title", async () => {
    getCodeStats.mockResolvedValue({
      conversations: 1,
      studentCount: 1,
      interactions: [{ ...interaction, userName: "Grace Hopper" }],
    });
    const html = await render(entry({ anonymous: false }));
    expect(html).toContain("Grace Hopper");
    expect(html).toContain('title="student-sub-1"');
  });

  it("forwards anonymous=false to the store", async () => {
    await render(entry({ anonymous: false }));
    expect(getCodeStats).toHaveBeenCalledWith(CODE, false);
  });

  it("labels the count column per module (quiz → Discussions)", async () => {
    const html = await render(entry({ anonymous: false, module: "quiz" }));
    expect(html).toContain("Discussions");
  });
});
