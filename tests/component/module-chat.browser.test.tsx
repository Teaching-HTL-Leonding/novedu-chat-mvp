import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

// Stub CopilotKit's v2 chat: the real provider can't mount under the test
// runner's bundled React (same constraint as the other chat suites), and this
// suite verifies only ModuleChat's SHARED wiring — the live chat is exercised by
// the e2e tests instead. The provider stub renders its children and reports its
// props to a spy; CopilotChat is a spy stub reporting its props. This is the one
// place the provider/threadId/markdown-renderer wiring is asserted: the
// per-module tests mock ModuleChat away and never re-check it.
const providerSpy = vi.hoisted(() => vi.fn());
const chatSpy = vi.hoisted(() => vi.fn());
// `useAgent` / `useCopilotKit` stubs: one fake agent (messages + setMessages,
// and a `subscribe` that records its subscriber so a test can start a run by
// hand) and a fake core whose `subscribe` records the error subscriber, so a
// test can fail a run exactly as CopilotKit reports it.
type Msg = { id: string; role: string; content: unknown };
const fake = vi.hoisted(() => {
  const state = {
    messages: [] as Msg[],
    agentSubscribers: [] as Array<{ onRunInitialized?: () => void }>,
    errorSubscribers: [] as Array<{
      onError?: (e: { error: Error; code: string; context: Record<string, unknown> }) => void;
    }>,
  };
  const agent = {
    get messages() {
      return state.messages;
    },
    setMessages: (next: Msg[]) => {
      state.messages = next;
    },
    subscribe: (subscriber: { onRunInitialized?: () => void }) => {
      state.agentSubscribers.push(subscriber);
      return { unsubscribe: () => {} };
    },
  };
  const copilotkit = {
    subscribe: (subscriber: (typeof state.errorSubscribers)[number]) => {
      state.errorSubscribers.push(subscriber);
      return { unsubscribe: () => {} };
    },
  };
  return { state, agent, copilotkit };
});
const useAgentSpy = vi.hoisted(() => vi.fn(() => ({ agent: fake.agent })));

vi.mock("@copilotkit/react-core/v2", () => ({
  CopilotKitProvider: ({ children, ...props }: { children: ReactNode }) => {
    providerSpy(props);
    return <div data-testid="ck-provider">{children}</div>;
  },
  CopilotChat: ({ agentId, ...props }: { agentId: string }) => {
    chatSpy({ agentId, ...props });
    return <div data-testid="ck-chat">{agentId}</div>;
  },
  useAgent: useAgentSpy,
  useCopilotKit: () => ({ copilotkit: fake.copilotkit }),
}));

import { MarkdownRenderer } from "@/app/markdown-renderer";
import { ModuleChat } from "@/app/module-chat";

type ModuleChatProps = ComponentProps<typeof ModuleChat>;

const AGENT_ID = "tutor";
const THREAD_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const PROVIDER_KEY = "a1b2c3d4e5";
const RUNTIME_HEADERS = {
  "x-code": "a1b2c3d4e5",
  "x-thread-token": "deadbeef".repeat(8),
};

test("points the provider at the runtime URL and forwards the headers verbatim", async () => {
  await render(
    <ModuleChat
      agentId={AGENT_ID}
      threadId={THREAD_ID}
      headers={RUNTIME_HEADERS}
      providerKey={PROVIDER_KEY}
      className="chat"
    />,
  );

  // The code travels as the x-code header (never the runtimeUrl query string),
  // re-checked server-side on every request.
  expect(providerSpy.mock.lastCall?.[0]).toMatchObject({
    runtimeUrl: "/api/copilotkit",
    headers: RUNTIME_HEADERS,
  });
});

test("pins the server-generated threadId on CopilotChat (explicit mode)", async () => {
  await render(
    <ModuleChat
      agentId={AGENT_ID}
      threadId={THREAD_ID}
      headers={RUNTIME_HEADERS}
      providerKey={PROVIDER_KEY}
      className="chat"
    />,
  );

  // The id goes through CopilotChat's `threadId` prop (explicit mode — the only
  // mode where the pinned thread reliably carries the conversation).
  expect(chatSpy.mock.lastCall?.[0].threadId).toBe(THREAD_ID);
});

test("mounts the chat for the passed agent", async () => {
  const screen = await render(
    <ModuleChat
      agentId="writing"
      threadId={THREAD_ID}
      headers={RUNTIME_HEADERS}
      providerKey={PROVIDER_KEY}
      className="chat"
    />,
  );

  await expect.element(screen.getByTestId("ck-chat")).toHaveTextContent("writing");
  expect(chatSpy.mock.lastCall?.[0].agentId).toBe("writing");
});

test("wires the shared markdown renderer for assistant messages", async () => {
  await render(
    <ModuleChat
      agentId={AGENT_ID}
      threadId={THREAD_ID}
      headers={RUNTIME_HEADERS}
      providerKey={PROVIDER_KEY}
      className="chat"
    />,
  );

  // The same renderer everywhere, so math/code/markdown match across modules.
  expect(chatSpy.mock.lastCall?.[0].messageView?.assistantMessage?.markdownRenderer).toBe(
    MarkdownRenderer,
  );
});

test("overrides the cursor slot with a readable 'Generating…' note", async () => {
  await render(
    <ModuleChat
      agentId={AGENT_ID}
      threadId={THREAD_ID}
      headers={RUNTIME_HEADERS}
      providerKey={PROVIDER_KEY}
      className="chat"
    />,
  );

  // Students never receive reasoning (the runtime strips it — docs/chat.md), so
  // CopilotKit's cursor is what they see for the whole run; it must read as a
  // note, not a bare pulsing dot, and its wording must stay true for the whole
  // run on any model. The slot is global to every ModuleChat consumer, so it is
  // asserted here once.
  const Cursor = chatSpy.mock.lastCall?.[0].messageView?.cursor;
  expect(Cursor).toBeTypeOf("function");

  const screen = await render(<Cursor />);
  await expect.element(screen.getByTestId("chat-generating-note")).toHaveTextContent("Generating");
  // Muted + small, so it never competes with the answer.
  expect(screen.getByTestId("chat-generating-note").element().className).toContain(
    "text-muted-foreground",
  );
});

test("renders children directly inside the provider, before the chat", async () => {
  const screen = await render(
    <ModuleChat
      agentId={AGENT_ID}
      threadId={THREAD_ID}
      headers={RUNTIME_HEADERS}
      providerKey={PROVIDER_KEY}
      className="chat"
    >
      <div data-testid="slot-child">slot</div>
    </ModuleChat>,
  );

  // The child lives inside the provider (frontend tools / feedback headers need
  // the provider's React context) as a direct fragment member, with no wrapping
  // div: the primitive is layout-agnostic, so any module-specific layout container
  // (e.g. quiz's discussion body) is the module's own concern, outside ModuleChat.
  const provider = screen.getByTestId("ck-provider").element();
  const child = screen.getByTestId("slot-child").element();
  expect(child.parentElement).toBe(provider);

  // ...and it precedes the chat in document order.
  const chat = screen.getByTestId("ck-chat").element();
  expect(child.compareDocumentPosition(chat) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("passes labels, chatView, and attachments through to CopilotChat verbatim", async () => {
  const labels: ModuleChatProps["labels"] = { welcomeMessageText: "Hallo" };
  // A module's chatView is a component (tutor's welcome-screen override); the
  // cast names it as ModuleChat's slot type so we can assert it is forwarded by
  // reference, untouched.
  const chatView = (() => <div data-testid="custom-view" />) as ModuleChatProps["chatView"];
  const attachments: ModuleChatProps["attachments"] = {
    enabled: true,
    accept: "image/*",
    maxSize: 5 * 1024 * 1024,
  };

  await render(
    <ModuleChat
      agentId={AGENT_ID}
      threadId={THREAD_ID}
      headers={RUNTIME_HEADERS}
      providerKey={PROVIDER_KEY}
      className="chat"
      labels={labels}
      chatView={chatView}
      attachments={attachments}
    />,
  );

  const props = chatSpy.mock.lastCall?.[0];
  expect(props.labels).toBe(labels);
  expect(props.chatView).toBe(chatView);
  expect(props.attachments).toBe(attachments);
});

test("omits the optional slots when not given", async () => {
  await render(
    <ModuleChat
      agentId={AGENT_ID}
      threadId={THREAD_ID}
      headers={RUNTIME_HEADERS}
      providerKey={PROVIDER_KEY}
      className="chat"
    />,
  );

  const props = chatSpy.mock.lastCall?.[0];
  expect(props.labels).toBeUndefined();
  expect(props.chatView).toBeUndefined();
  expect(props.attachments).toBeUndefined();
});

test("owns the base chat container and cn-merges className as a delta", async () => {
  const screen = await render(
    <ModuleChat
      agentId={AGENT_ID}
      threadId={THREAD_ID}
      headers={RUNTIME_HEADERS}
      providerKey={PROVIDER_KEY}
      className="overflow-visible px-3"
    />,
  );

  // The fill recipe (min-h-0 flex-1 …) is ModuleChat's own — modules only pass
  // deltas, and a conflicting caller utility WINS over the base (tailwind-merge).
  const container = screen.getByTestId("ck-chat").element().parentElement;
  expect(container?.className).toContain("min-h-0");
  expect(container?.className).toContain("flex-1");
  expect(container?.className).toContain("px-3");
  expect(container?.className).toContain("overflow-visible");
  expect(container?.className).not.toContain("overflow-hidden");
});

// ---- Run errors in the chat (docs/chat.md) ----

beforeEach(() => {
  fake.state.messages = [];
  fake.state.agentSubscribers = [];
  fake.state.errorSubscribers = [];
});

/** Fails a run as CopilotKit does — the same failure under BOTH of its codes. */
function failRun(
  message: string,
  agentId = AGENT_ID,
  codes = ["agent_run_failed_event", "agent_run_failed"],
) {
  act(() => {
    for (const code of codes) {
      for (const subscriber of fake.state.errorSubscribers) {
        subscriber.onError?.({ error: new Error(message), code, context: { agentId } });
      }
    }
  });
}

const TOO_LONG = 'HTTP 413: {"error":"This message is too long."}';
const user = (id: string, content: unknown): Msg => ({ id, role: "user", content });
const reply: Msg = { id: "a1", role: "assistant", content: "answer" };

function renderChat() {
  return render(
    <ModuleChat
      agentId={AGENT_ID}
      threadId={THREAD_ID}
      headers={RUNTIME_HEADERS}
      providerKey={PROVIDER_KEY}
      className="chat"
    />,
  );
}

test("shows no error notice before anything failed", async () => {
  const screen = await renderChat();
  expect(screen.getByTestId("chat-error-notice").query()).toBeNull();
});

test("shows the route's own sentence when a run is rejected (e.g. the input limit)", async () => {
  const screen = await renderChat();
  failRun(TOO_LONG);
  const notice = screen.getByTestId("chat-error-notice");
  await expect.element(notice).toHaveTextContent("This message is too long.");
  await expect.element(notice).toHaveAttribute("role", "alert");
});

test("a rejected run takes its unanswered messages out of the history", async () => {
  fake.state.messages = [user("u1", "q1"), reply, user("u2", "x".repeat(9000))];
  const screen = await renderChat();
  failRun(TOO_LONG);
  // Otherwise every later attempt would re-send — and be refused for — it.
  expect(fake.state.messages).toEqual([user("u1", "q1"), reply]);
  await expect
    .element(screen.getByTestId("chat-error-notice"))
    .toHaveTextContent("Your message was not sent.");
  // Still offered for copying, even though the second report found nothing to drop.
  await expect.element(screen.getByRole("button", { name: "Copy my message" })).toBeVisible();
});

test("a server error (5xx) keeps the history and shows a generic sentence", async () => {
  fake.state.messages = [user("u1", "q1")];
  const screen = await renderChat();
  failRun('HTTP 500: {"error":"internal detail"}');
  expect(fake.state.messages).toEqual([user("u1", "q1")]);
  const notice = screen.getByTestId("chat-error-notice");
  await expect.element(notice).toHaveTextContent(/something went wrong/i);
  await expect.element(notice).not.toHaveTextContent("internal detail");
  expect(screen.getByRole("button", { name: "Copy my message" }).query()).toBeNull();
});

test("a failed connect shows the notice but leaves the restored history alone", async () => {
  // A resumed tutor thread whose last stored message is the student's.
  fake.state.messages = [user("u1", "q1"), reply, user("u2", "stored question")];
  const screen = await renderChat();
  failRun('HTTP 403: {"error":"The availability window has ended."}', AGENT_ID, [
    "agent_connect_failed",
  ]);
  expect(fake.state.messages).toHaveLength(3);
  await expect
    .element(screen.getByTestId("chat-error-notice"))
    .toHaveTextContent("availability window has ended");
  expect(screen.getByRole("button", { name: "Copy my message" }).query()).toBeNull();
});

test("ignores an error that belongs to another agent", async () => {
  fake.state.messages = [user("u1", "q1")];
  const screen = await renderChat();
  failRun(TOO_LONG, "someOtherAgent");
  expect(screen.getByTestId("chat-error-notice").query()).toBeNull();
  expect(fake.state.messages).toEqual([user("u1", "q1")]);
});

test("the notice can be dismissed", async () => {
  const screen = await renderChat();
  failRun(TOO_LONG);
  await screen.getByRole("button", { name: "Dismiss" }).click();
  expect(screen.getByTestId("chat-error-notice").query()).toBeNull();
});

test("the notice clears when the next run starts", async () => {
  const screen = await renderChat();
  failRun(TOO_LONG);
  await expect.element(screen.getByTestId("chat-error-notice")).toBeInTheDocument();
  act(() => {
    for (const subscriber of fake.state.agentSubscribers) subscriber.onRunInitialized?.();
  });
  expect(screen.getByTestId("chat-error-notice").query()).toBeNull();
});

test("listens on the chat's own agent (no threadId — that would register a second agent)", async () => {
  useAgentSpy.mockClear();
  await renderChat();
  expect(useAgentSpy).toHaveBeenCalledWith({ agentId: AGENT_ID });
});

test("a notice from the previous conversation does not survive a new providerKey", async () => {
  const screen = await renderChat();
  failRun(TOO_LONG);
  await expect.element(screen.getByTestId("chat-error-notice")).toBeInTheDocument();
  // The tutor's "start over": a new providerKey remounts the provider subtree.
  await screen.rerender(
    <ModuleChat
      agentId={AGENT_ID}
      threadId={THREAD_ID}
      headers={RUNTIME_HEADERS}
      providerKey="next-conversation"
      className="chat"
    />,
  );
  expect(screen.getByTestId("chat-error-notice").query()).toBeNull();
});
