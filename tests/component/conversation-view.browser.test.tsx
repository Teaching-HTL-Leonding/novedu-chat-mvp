import type { Message } from "@ag-ui/core";
import type { ReactNode } from "react";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

// Stub CopilotKit's v2 message components: the real ones reach into
// CopilotKitCore (same constraint as tutor-chat.browser.test.tsx), and the live
// transcript render is exercised by the e2e chat. What THIS suite pins is
// ConversationView's own wiring — that it routes each message to the SAME
// component the live chat uses (user → CopilotChatUserMessage, assistant →
// CopilotChatAssistantMessage with the tutor's markdown renderer), READ-ONLY,
// inside the provider, with no chat input.
const providerSpy = vi.hoisted(() => vi.fn());
const userSpy = vi.hoisted(() => vi.fn());
const assistantSpy = vi.hoisted(() => vi.fn());

vi.mock("@copilotkit/react-core/v2", () => ({
  CopilotKitProvider: ({ children, ...props }: { children: ReactNode }) => {
    providerSpy(props);
    return <div data-testid="ck-provider">{children}</div>;
  },
  CopilotChatUserMessage: (props: { message: { content: string } }) => {
    userSpy(props);
    return <div data-testid="ck-user">{props.message.content}</div>;
  },
  CopilotChatAssistantMessage: (props: { message: { content: string } }) => {
    assistantSpy(props);
    return <div data-testid="ck-assistant">{props.message.content}</div>;
  },
}));

import { ConversationView } from "@/app/tutor-codes/[code]/c/[threadId]/conversation-view";

const MESSAGES: Message[] = [
  { id: "m1", role: "user", content: "Hi" },
  { id: "m2", role: "assistant", content: "Hello there" },
];

test("routes each message to the matching CopilotKit component", async () => {
  const screen = await render(<ConversationView messages={MESSAGES} />);

  await expect.element(screen.getByTestId("ck-provider")).toBeInTheDocument();
  await expect.element(screen.getByTestId("ck-user")).toHaveTextContent("Hi");
  await expect.element(screen.getByTestId("ck-assistant")).toHaveTextContent("Hello there");
  expect(userSpy.mock.lastCall?.[0].message).toMatchObject({ id: "m1", role: "user" });
  expect(assistantSpy.mock.lastCall?.[0].message).toMatchObject({ id: "m2", role: "assistant" });
});

test("wires the tutor's markdown renderer for assistant messages", async () => {
  assistantSpy.mockClear();
  await render(<ConversationView messages={MESSAGES} />);
  // Same renderer the live chat uses, so math/code/markdown match the real chat.
  expect(assistantSpy.mock.lastCall?.[0].markdownRenderer).toBeTypeOf("function");
});

test("is read-only: renders no chat input", async () => {
  const screen = await render(<ConversationView messages={MESSAGES} />);
  // The teacher views, cannot chat — there is no composer.
  expect(screen.container.querySelector("textarea")).toBeNull();
  expect(screen.getByRole("textbox").query()).toBeNull();
});

test("points the provider at the runtime URL (its /info is auth-only metadata)", async () => {
  providerSpy.mockClear();
  await render(<ConversationView messages={MESSAGES} />);
  expect(providerSpy.mock.lastCall?.[0]).toMatchObject({ runtimeUrl: "/api/copilotkit" });
});

test("renders an empty transcript without error", async () => {
  const screen = await render(<ConversationView messages={[]} />);
  await expect.element(screen.getByTestId("ck-provider")).toBeInTheDocument();
  expect(screen.getByTestId("ck-user").query()).toBeNull();
  expect(screen.getByTestId("ck-assistant").query()).toBeNull();
});
