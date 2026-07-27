import type { ComponentProps } from "react";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { ModuleChat as ModuleChatType } from "@/app/module-chat";

// TutorChat is re-expressed on top of the shared ModuleChat primitive, so this
// suite mocks ModuleChat away and asserts only what is unique to the tutor: the
// upload-error notice, the welcome view it composes, and the props it hands
// ModuleChat. The shared chat wiring (provider headers, the threadId explicit
// mode, the markdown renderer) is owned and tested once by
// module-chat.browser.test.tsx — it is not re-checked here.
//
// The mock renders ModuleChat's children (so any provider-context children would
// mount) and reports its props to a spy. The captured `chatView` is the tutor's
// own welcome override (from useTutorWelcomeView), which renders CopilotChat.View
// — so the copilotkit mock supplies a callable `View` (reporting to viewSpy) and
// the `View.WelcomeMessage` greeting stub the welcome screen composes on top of.
const moduleChatSpy = vi.hoisted(() => vi.fn());
const viewSpy = vi.hoisted(() => vi.fn());

vi.mock("@/app/module-chat", () => ({
  ModuleChat: (props: ComponentProps<typeof ModuleChatType>) => {
    moduleChatSpy(props);
    return <div data-testid="module-chat">{props.children}</div>;
  },
}));

vi.mock("@copilotkit/react-core/v2", () => {
  const CopilotChat = {
    View: Object.assign(
      (props: Record<string, unknown>) => {
        viewSpy(props);
        return <div data-testid="ck-view" />;
      },
      { WelcomeMessage: () => <h1 data-testid="ck-welcome-message">greeting</h1> },
    ),
  };
  return { CopilotChat };
});

// TutorChat mounts the shared ReportButton, which statically imports the report
// server actions; mock them so the browser bundle doesn't pull next/cache.
vi.mock("@/lib/report-actions", () => ({ submitChatReport: vi.fn(), submitQuizReport: vi.fn() }));

import { TutorChat } from "@/app/tutor-chat";

const TUTOR_CODE = "a1b2c3d4e5";
const THREAD_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const RUNTIME_HEADERS = {
  "x-code": TUTOR_CODE,
  "x-thread-token": "deadbeef".repeat(8),
};

// Every test renders the same minimal surface; overrides carry the per-test
// deltas (title, imageInput, exampleQuestions, …).
function renderTutorChat(overrides: Partial<ComponentProps<typeof TutorChat>> = {}) {
  moduleChatSpy.mockClear();
  return render(
    <TutorChat
      code={TUTOR_CODE}
      threadId={THREAD_ID}
      runtimeHeaders={RUNTIME_HEADERS}
      imageInput={false}
      description="Beschreibung des Tutors"
      {...overrides}
    />,
  );
}

test("renders the shared chat primitive and nothing above it", async () => {
  const screen = await renderTutorChat();

  await expect.element(screen.getByTestId("module-chat")).toBeInTheDocument();
  // The debug header (tutor URL + "System prompt & warnings" preview) is gone —
  // students see only the chat.
  expect(document.querySelector("details")).toBeNull();
});

test("hands ModuleChat the tutor agent, code-keyed provider, threadId and headers", async () => {
  await renderTutorChat();

  expect(moduleChatSpy.mock.lastCall?.[0]).toMatchObject({
    agentId: "tutor",
    providerKey: TUTOR_CODE,
    threadId: THREAD_ID,
    headers: RUNTIME_HEADERS,
  });
  // The welcome screen is supplied as a chatView function.
  expect(moduleChatSpy.mock.lastCall?.[0].chatView).toBeTypeOf("function");
});

test("enables image attachments (images only, 5 MB cap) when the tutor opts in", async () => {
  await renderTutorChat({ imageInput: true });

  expect(moduleChatSpy.mock.lastCall?.[0].attachments).toMatchObject({
    enabled: true,
    accept: "image/*",
    maxSize: 5 * 1024 * 1024,
  });
  expect(moduleChatSpy.mock.lastCall?.[0].attachments.onUploadFailed).toBeTypeOf("function");
});

test("passes no attachments config when the tutor does not opt in", async () => {
  await renderTutorChat();

  expect(moduleChatSpy.mock.lastCall?.[0].attachments).toBeUndefined();
});

test("passes the tutor title as the welcome greeting label", async () => {
  await renderTutorChat({ title: "Dein Tutor für verkettete Listen" });

  expect(moduleChatSpy.mock.lastCall?.[0].labels).toEqual({
    welcomeMessageText: "Dein Tutor für verkettete Listen",
  });
});

test("keeps CopilotKit's default greeting when the tutor has no title", async () => {
  await renderTutorChat();

  expect(moduleChatSpy.mock.lastCall?.[0].labels).toBeUndefined();
});

test("the welcome view forces the welcome screen back on in explicit-threadId mode", async () => {
  viewSpy.mockClear();
  await renderTutorChat();

  // Explicit mode (the threadId ModuleChat pins) suppresses the view's welcome
  // screen; the chatView wrapper must override the two flags that gate it, no
  // matter what CopilotChat passes down.
  const ChatView = moduleChatSpy.mock.lastCall?.[0].chatView;
  await render(<ChatView hasExplicitThreadId={true} isConnecting={true} />);
  expect(viewSpy.mock.lastCall?.[0]).toMatchObject({
    hasExplicitThreadId: false,
    isConnecting: false,
  });
});

// The tutor customizes the welcome screen through the chatView slot it hands
// ModuleChat (the only way to reach the chat input's onInputChange). The stubbed
// CopilotChat.View never renders its slots itself, so tests drive the chain by
// hand: render the captured chatView (which renders the stubbed CopilotChat.View
// and reports its props to viewSpy), then render the welcomeMessage sub-slot it
// composed.
async function renderWelcomeMessage(viewProps: Record<string, unknown> = {}) {
  viewSpy.mockClear();
  const ChatView = moduleChatSpy.mock.lastCall?.[0].chatView;
  expect(ChatView).toBeTypeOf("function");
  await render(<ChatView {...viewProps} />);
  const WelcomeMessage = viewSpy.mock.lastCall?.[0].welcomeScreen?.welcomeMessage;
  expect(WelcomeMessage).toBeTypeOf("function");
  return render(<WelcomeMessage />);
}

test("the welcome screen slot composes the built-in greeting plus the description", async () => {
  await renderTutorChat({ description: "Ich helfe dir Schritt für Schritt." });

  const screen = await renderWelcomeMessage();
  await expect.element(screen.getByTestId("ck-welcome-message")).toBeInTheDocument();
  await expect.element(screen.getByText("Ich helfe dir Schritt für Schritt.")).toBeInTheDocument();
});

const EXAMPLE_QUESTIONS = [
  { title: "Was ist eine Liste?", question: "Kannst du mir erklären, was eine Liste ist?" },
  { title: "Knoten einfügen", question: "Wie füge ich einen Knoten am Anfang ein?" },
];

test("example questions render as buttons with the question text as tooltip", async () => {
  await renderTutorChat({ exampleQuestions: EXAMPLE_QUESTIONS });

  const screen = await renderWelcomeMessage();
  for (const { title, question } of EXAMPLE_QUESTIONS) {
    const button = screen.getByRole("button", { name: title });
    await expect.element(button).toBeVisible();
    await expect.element(button).toHaveAttribute("title", question);
  }
});

test("clicking an example question fills the chat input without sending", async () => {
  await renderTutorChat({ exampleQuestions: EXAMPLE_QUESTIONS });

  const onInputChange = vi.fn();
  const onSubmitMessage = vi.fn();
  const screen = await renderWelcomeMessage({ onInputChange, onSubmitMessage });
  await screen.getByRole("button", { name: "Knoten einfügen" }).click();

  expect(onInputChange).toHaveBeenCalledExactlyOnceWith("Wie füge ich einen Knoten am Anfang ein?");
  // Filling the input must not submit the message.
  expect(onSubmitMessage).not.toHaveBeenCalled();
});

test("renders no question list when the tutor defines no example questions", async () => {
  await renderTutorChat();

  const screen = await renderWelcomeMessage();
  expect(screen.container.querySelector("ul")).toBeNull();
});

test("a failed upload shows a dismissible notice", async () => {
  const screen = await renderTutorChat({ imageInput: true });

  // Simulate CopilotKit rejecting a file (too large / wrong type): the chat
  // calls onUploadFailed, and TutorChat must surface the reason to the student.
  const attachments = moduleChatSpy.mock.lastCall?.[0].attachments;
  if (!attachments) throw new Error("attachments config was not passed to ModuleChat");
  attachments.onUploadFailed({
    reason: "file-too-large",
    file: new File([], "homework.png"),
    message: "File exceeds the 5 MB limit",
  });

  const notice = screen.getByRole("alert");
  await expect.element(notice).toBeVisible();
  await expect.element(notice).toHaveTextContent("homework.png: File exceeds the 5 MB limit");

  await screen.getByRole("button", { name: "Dismiss" }).click();
  expect(screen.getByRole("alert").query()).toBeNull();
});
