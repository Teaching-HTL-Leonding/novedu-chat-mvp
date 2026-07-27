import type { ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";

// The quiz per-question discussion chat (app/[code]/_quiz/quiz-discussion.tsx):
// a thin wrapper that mounts the shared ModuleChat for the `quizDiscussion`
// agent and, when the question was graded, shows the FEEDBACK markdown above the
// live chat. These specs pin only what is unique to QuizDiscussion — the props
// it hands ModuleChat and the feedback header it composes as the provider child.
// The shared provider / threadId / markdown wiring is owned (and tested) by
// ModuleChat, so it is mocked away here.
//
// ModuleChat is stubbed to render its {children} (so the feedback header mounts)
// and to report its props to a spy. The real MarkdownRenderer is kept so the
// feedback assertion exercises the renderer the student feedback flows through.
const moduleChatSpy = vi.hoisted(() => vi.fn());
vi.mock("@/app/module-chat", () => ({
  ModuleChat: ({ children, ...props }: { children: ReactNode }) => {
    moduleChatSpy(props);
    return <div data-testid="module-chat">{children}</div>;
  },
}));

// QuizDiscussion mounts the shared ReportButton, which statically imports the
// report server actions; mock them so the browser bundle doesn't pull next/cache.
vi.mock("@/lib/report-actions", () => ({ submitChatReport: vi.fn(), submitQuizReport: vi.fn() }));

import { QuizDiscussion } from "@/app/[code]/_quiz/quiz-discussion";

const THREAD_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const RUNTIME_HEADERS = { "x-code": "a1b2c3d4e5", "x-thread-token": "deadbeef".repeat(8) };

function renderDiscussion(feedback: string) {
  return render(
    <QuizDiscussion threadId={THREAD_ID} headers={RUNTIME_HEADERS} feedback={feedback} />,
  );
}

// Each spec mounts a fresh tree; unmount between tests so a stale ModuleChat
// stub never lingers in the document.
afterEach(() => {
  cleanup();
});

test("renders the graded feedback markdown as the ModuleChat child", async () => {
  const screen = await renderDiscussion("## Well done");

  // The feedback header is composed inside the ModuleChat provider (its child)…
  const child = screen.getByTestId("module-chat");
  await expect.element(child).toBeInTheDocument();
  // …and runs through the real MarkdownRenderer, turning `## Well done` into a heading.
  await expect.element(screen.getByRole("heading", { name: "Well done" })).toBeVisible();
});

test("shows no feedback block when there is no feedback", async () => {
  const screen = await renderDiscussion("");

  // The chat still mounts, but the feedback header (and any heading) is absent.
  await expect.element(screen.getByTestId("module-chat")).toBeInTheDocument();
  expect(screen.getByRole("heading").query()).toBeNull();
});

test("hands ModuleChat the discussion agent, threadId-keyed provider, threadId, and headers", async () => {
  moduleChatSpy.mockClear();
  await renderDiscussion("## Well done");

  expect(moduleChatSpy.mock.lastCall?.[0]).toMatchObject({
    agentId: "quizDiscussion",
    // Provider keyed by threadId: a fresh thread per question remounts the chat.
    providerKey: THREAD_ID,
    threadId: THREAD_ID,
    headers: RUNTIME_HEADERS,
  });
});

test("wraps ModuleChat in its own discussion-body layout container", async () => {
  const screen = await renderDiscussion("## Well done");

  // The modal-body flex wrapper (feedback + chat sharing a column) is
  // QuizDiscussion's own layout, not the primitive's — ModuleChat is layout-
  // agnostic — so QuizDiscussion wraps it in its discussion-body div.
  const wrapper = screen.getByTestId("module-chat").element().parentElement;
  expect(wrapper).toBe(screen.getByTestId("discussion-body").element());
});
