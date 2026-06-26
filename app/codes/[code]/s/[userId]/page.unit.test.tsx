// @vitest-environment node

import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The student text page (app/codes/[code]/s/[userId]/page.tsx): a teacher reads one
// student's saved writing, with Prev/Next across the savers list and the student's
// conversations below. Pinned without infra: gating, the found/unknown/not-writing/
// anonymous/no-submission branches, the word/char header, Prev/Next at the ends,
// and that the (untrusted) text is routed through the MarkdownRenderer. The client
// lightbox + MarkdownRenderer are stubbed; I/O is mocked. No DB, runs in CI.

const isEffectiveTeacher = vi.hoisted(() => vi.fn());
const getCode = vi.hoisted(() => vi.fn());
const getSubmission = vi.hoisted(() => vi.fn());
const listSavers = vi.hoisted(() => vi.fn());
const listStudentConversations = vi.hoisted(() => vi.fn());

vi.mock("@/lib/student-mode", () => ({ isEffectiveTeacher }));
vi.mock("@/lib/code-store", () => ({ getCode }));
vi.mock("@/lib/writing-store", () => ({ getSubmission, listSavers }));
vi.mock("@/lib/code-stats-store", () => ({ listStudentConversations }));
// Stub the client lightbox (it imports the server action + CopilotKit) and the
// markdown renderer (asserting it RECEIVES the raw text proves the text is routed
// through the sanitized renderer; sanitization itself is covered against the
// renderer directly in writing-surface.browser.test).
vi.mock("./student-conversations", () => ({
  StudentConversations: ({ conversations }: { conversations: unknown[] }) => (
    <div data-testid="conversations">{conversations.length} conversations</div>
  ),
}));
vi.mock("@/app/markdown-renderer", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div data-testid="md">{content}</div>,
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import StudentTextPage from "./page";

const CODE = "a1b2c3d4e5";
const USER = "student-oid-2";

function code(overrides: Record<string, unknown> = {}) {
  return {
    code: CODE,
    module: "writing",
    fileUrl: "https://example.com/w.yaml",
    note: "My Class",
    anonymous: false,
    ...overrides,
  };
}

function submission(text: string) {
  return { code: CODE, userId: USER, text, textUpdatedAt: new Date("2026-06-12T10:00:00Z") };
}

async function render(userId = USER) {
  const element = await StudentTextPage({ params: Promise.resolve({ code: CODE, userId }) });
  return renderToStaticMarkup(element);
}

beforeEach(() => {
  vi.clearAllMocks();
  isEffectiveTeacher.mockResolvedValue(true);
  getCode.mockResolvedValue(code());
  getSubmission.mockResolvedValue(submission("Hello world essay"));
  listSavers.mockResolvedValue([{ userId: USER }]);
  listStudentConversations.mockResolvedValue([]);
});

describe("gating + not-found branches", () => {
  it("denies a non-teacher", async () => {
    isEffectiveTeacher.mockResolvedValue(false);
    expect(await render()).toContain("Access denied");
    expect(getCode).not.toHaveBeenCalled();
  });

  it("shows a transient notice when the code lookup fails", async () => {
    getCode.mockResolvedValue(undefined);
    expect(await render()).toContain("Text temporarily unavailable");
  });

  it("404-equivalents an unknown code", async () => {
    getCode.mockResolvedValue(null);
    expect(await render()).toContain("Not found");
  });

  it("404-equivalents a non-writing code", async () => {
    getCode.mockResolvedValue(code({ module: "tutor" }));
    expect(await render()).toContain("Not found");
  });

  it("404-equivalents an anonymous writing code (no per-student text)", async () => {
    getCode.mockResolvedValue(code({ anonymous: true }));
    expect(await render()).toContain("Not found");
  });

  it("shows 'no saved text' when the student has not saved", async () => {
    getSubmission.mockResolvedValue(null);
    expect(await render()).toContain("No saved text");
  });
});

describe("rendering the saved text", () => {
  it("shows the student id, the word/char header, and the text via MarkdownRenderer", async () => {
    const html = await render();
    expect(html).toContain(USER);
    expect(html).toContain("3 words"); // "Hello world essay"
    expect(html).toContain("15 characters"); // letters only, no whitespace
    expect(html).toContain('data-testid="md"');
    expect(html).toContain("Hello world essay");
  });

  it("forwards the student's conversations to the lightbox component", async () => {
    listStudentConversations.mockResolvedValue([{ threadId: "t1" }, { threadId: "t2" }]);
    const html = await render();
    expect(html).toContain("2 conversations");
  });

  it("shows the resolved display name from the savers row, with the oid as the hover title", async () => {
    listSavers.mockResolvedValue([{ userId: USER, displayName: "Ada Lovelace" }]);
    const html = await render();
    expect(html).toContain("Ada Lovelace");
    expect(html).toContain(`title="${USER}"`);
  });
});

describe("Prev/Next across the savers list", () => {
  it("links to both neighbours for a middle student", async () => {
    listSavers.mockResolvedValue([{ userId: "u-prev" }, { userId: USER }, { userId: "u-next" }]);
    const html = await render();
    expect(html).toContain(`/codes/${CODE}/s/u-prev`);
    expect(html).toContain(`/codes/${CODE}/s/u-next`);
  });

  it("disables Previous for the first student", async () => {
    listSavers.mockResolvedValue([{ userId: USER }, { userId: "u-next" }]);
    const html = await render();
    expect(html).not.toContain(`/codes/${CODE}/s/u-prev`);
    expect(html).toContain(`/codes/${CODE}/s/u-next`);
    expect(html).toContain("Previous"); // present but as a disabled span
  });
});
