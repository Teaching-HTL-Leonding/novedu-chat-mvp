import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";

// The student page's conversation list + lightbox (client). The conversation
// METADATA is server-provided; a transcript is fetched only on OPEN via the
// teacher-gated action, cached so reopening does not refetch, and rendered
// read-only through ConversationView. The action + ConversationView are mocked
// (ConversationView pulls in CopilotKit, exercised by the e2e instead).

const loadConversationTranscript = vi.hoisted(() => vi.fn());
vi.mock("@/lib/code-stats-actions", () => ({ loadConversationTranscript }));
vi.mock("@/app/codes/[code]/c/[threadId]/conversation-view", () => ({
  ConversationView: ({ messages }: { messages: unknown[] }) => (
    <div data-testid="cv">{messages.length} msgs</div>
  ),
}));

import { StudentConversations } from "@/app/codes/[code]/s/[userId]/student-conversations";

const CODE = "a1b2c3d4e5";
const CONVERSATIONS = [
  {
    threadId: "t1",
    firstAt: new Date("2026-06-12T10:00:00Z"),
    lastAt: new Date("2026-06-12T10:05:00Z"),
    userMessageCount: 2,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  loadConversationTranscript.mockResolvedValue([
    { id: "m1", role: "user", content: "Hi" },
    { id: "m2", role: "assistant", content: "Hello" },
  ]);
});

afterEach(() => {
  cleanup();
});

test("shows an empty state when the student has no conversations", async () => {
  const screen = await render(<StudentConversations code={CODE} conversations={[]} />);
  await expect.element(screen.getByText("No conversations yet.")).toBeVisible();
});

test("lists each conversation with its message count", async () => {
  const screen = await render(<StudentConversations code={CODE} conversations={CONVERSATIONS} />);
  await expect.element(screen.getByTestId("conversation-open")).toHaveTextContent("2 messages");
});

test("opens a conversation, lazy-loading the transcript once via the action", async () => {
  const screen = await render(<StudentConversations code={CODE} conversations={CONVERSATIONS} />);
  await screen.getByTestId("conversation-open").click();

  await expect.element(screen.getByTestId("cv")).toHaveTextContent("2 msgs");
  expect(loadConversationTranscript).toHaveBeenCalledTimes(1);
  expect(loadConversationTranscript).toHaveBeenCalledWith(CODE, "t1");
});

test("caches the transcript so reopening does not refetch", async () => {
  const screen = await render(<StudentConversations code={CODE} conversations={CONVERSATIONS} />);
  const button = screen.getByTestId("conversation-open");

  await button.click();
  await expect.element(screen.getByTestId("cv")).toBeVisible();
  await screen.getByRole("button", { name: "Close" }).click();

  // Reopen the same conversation: served from cache, no second action call.
  await button.click();
  await expect.element(screen.getByTestId("cv")).toBeVisible();
  expect(loadConversationTranscript).toHaveBeenCalledTimes(1);
});

test("surfaces a load error", async () => {
  loadConversationTranscript.mockResolvedValue(undefined);
  const screen = await render(<StudentConversations code={CODE} conversations={CONVERSATIONS} />);
  await screen.getByTestId("conversation-open").click();
  await expect.element(screen.getByText("Conversation temporarily unavailable")).toBeVisible();
});
