// @vitest-environment node

import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

// `app/codes/[code]/c/[threadId]/page.tsx` is the read-only conversation viewer.
// The transcript itself (CopilotChatMessageView) is exercised by the live chat
// e2e; here we pin the SERVER-side gating and the loading/empty branches without
// infra. Any effective teacher may open any code's conversation now (`getCode`,
// no ownership check). The CopilotKit client view is stubbed so the test needs no
// provider/runtime.

const isEffectiveTeacher = vi.hoisted(() => vi.fn());
const getCode = vi.hoisted(() => vi.fn());
const getConversationMessages = vi.hoisted(() => vi.fn());

vi.mock("@/lib/student-mode", () => ({ isEffectiveTeacher }));
vi.mock("@/lib/code-store", () => ({ getCode }));
vi.mock("@/lib/code-stats-store", () => ({ getConversationMessages }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
// Stub the CopilotKit transcript so the happy path needs no provider/runtime.
vi.mock("./conversation-view", () => ({
  ConversationView: ({ messages }: { messages: unknown[] }) => (
    <div data-testid="transcript">{messages.length} messages</div>
  ),
}));

import ConversationPage from "./page";

const CODE = "a1b2c3d4e5";
const THREAD = "thread-1";

function entry() {
  return { code: CODE, createdBy: "teacher-sub-1", note: "My Class", anonymous: true };
}

async function render(code = CODE, threadId = THREAD, from?: string) {
  const element = await ConversationPage({
    params: Promise.resolve({ code, threadId }),
    searchParams: Promise.resolve(from === undefined ? {} : { from }),
  });
  return renderToStaticMarkup(element);
}

beforeEach(() => {
  vi.clearAllMocks();
  isEffectiveTeacher.mockResolvedValue(true);
});

it("denies a non-teacher", async () => {
  isEffectiveTeacher.mockResolvedValue(false);
  const html = await render();
  expect(html).toContain("Access denied");
  expect(getConversationMessages).not.toHaveBeenCalled();
});

it("shows a transient notice when the lookup fails", async () => {
  getCode.mockResolvedValue(undefined);
  const html = await render();
  expect(html).toContain("Conversation temporarily unavailable");
});

it("shows 'not found' for an unknown code", async () => {
  getCode.mockResolvedValue(null);
  const html = await render();
  expect(html).toContain("Conversation not found");
});

it("shows a transient notice when the messages fail to load", async () => {
  getCode.mockResolvedValue(entry());
  getConversationMessages.mockResolvedValue(undefined);
  const html = await render();
  expect(html).toContain("Conversation temporarily unavailable");
});

it("notes an empty conversation", async () => {
  getCode.mockResolvedValue(entry());
  getConversationMessages.mockResolvedValue([]);
  const html = await render();
  expect(html).toContain("no messages");
});

it("renders the transcript and a back link to the code's stats", async () => {
  getCode.mockResolvedValue(entry());
  getConversationMessages.mockResolvedValue([
    { id: "m1", role: "user", content: "Hi" },
    { id: "m2", role: "assistant", content: "Hello" },
  ]);
  const html = await render();
  expect(html).toContain('data-testid="transcript"');
  expect(html).toContain("2 messages");
  // Back button is a deterministic link to the parent (stats) route.
  expect(html).toContain(`href="/codes/${CODE}"`);
  expect(html).toContain("Back to stats");
});

it("switches the back link to the reports inbox for the whitelisted from=reports", async () => {
  getCode.mockResolvedValue(entry());
  getConversationMessages.mockResolvedValue([{ id: "m1", role: "user", content: "Hi" }]);
  const html = await render(CODE, THREAD, "reports");
  expect(html).toContain('href="/reports"');
  expect(html).toContain("Back to reports");
  expect(html).not.toContain("Back to stats");
});

it("ignores an unrecognized from value and keeps the stats back link", async () => {
  getCode.mockResolvedValue(entry());
  getConversationMessages.mockResolvedValue([{ id: "m1", role: "user", content: "Hi" }]);
  // A non-whitelisted value (e.g. an attacker-supplied path) never becomes the href.
  const html = await render(CODE, THREAD, "/evil.example.com");
  expect(html).toContain(`href="/codes/${CODE}"`);
  expect(html).toContain("Back to stats");
  expect(html).not.toContain("evil.example.com");
});
