import type { ReactNode } from "react";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

// Stub CopilotKit's v2 chat: the real provider can't mount under the test
// runner's bundled React, and this suite verifies TutorChat's own rendering —
// the live chat is exercised by the e2e tests instead. The provider stub
// reports its props to a spy so we can assert the tutor code and thread token
// are forwarded as headers (the backend re-verifies them on every request).
const providerSpy = vi.hoisted(() => vi.fn());
const chatSpy = vi.hoisted(() => vi.fn());
const viewSpy = vi.hoisted(() => vi.fn());

vi.mock("@copilotkit/react-core/v2", () => {
  // TutorChat wraps `CopilotChat.View` in its chatView slot override (to reach
  // the input's onInputChange setter), so the `View` stub must be callable and
  // report its props; `View.WelcomeMessage` stands in for the built-in greeting.
  const CopilotChat = Object.assign(
    ({ agentId, ...props }: { agentId: string }) => {
      chatSpy({ agentId, ...props });
      return <div data-testid="ck-chat">{agentId}</div>;
    },
    {
      View: Object.assign(
        (props: Record<string, unknown>) => {
          viewSpy(props);
          return <div data-testid="ck-view" />;
        },
        { WelcomeMessage: () => <h1 data-testid="ck-welcome-message">greeting</h1> },
      ),
    },
  );
  return {
    CopilotKitProvider: ({ children, ...props }: { children: ReactNode }) => {
      providerSpy(props);
      return <div data-testid="ck-provider">{children}</div>;
    },
    CopilotChat,
  };
});

import { TutorChat } from "@/app/tutor-chat";

const TUTOR_URL = "https://example.com/tutor.yaml";
const TUTOR_CODE = "a1b2c3d4e5";
const THREAD_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const RUNTIME_HEADERS = {
  "x-tutor-code": TUTOR_CODE,
  "x-thread-token": "deadbeef".repeat(8),
};

test("renders the chat with the tutor bar and prompt preview", async () => {
  const screen = await render(
    <TutorChat
      code={TUTOR_CODE}
      threadId={THREAD_ID}
      tutorUrl={TUTOR_URL}
      runtimeHeaders={RUNTIME_HEADERS}
      prompt={"# Hello\n\nMass-energy: $E=mc^2$."}
      warnings={[]}
      imageInput={false}
      description="Beschreibung des Tutors"
    />,
  );

  // The tutor URL is shown (no "Change tutor" control anymore — the tutor is
  // fixed by the share link).
  await expect.element(screen.getByTitle(TUTOR_URL)).toBeVisible();
  expect(screen.getByRole("button", { name: "Change tutor" }).query()).toBeNull();

  // The chat is mounted for the `tutor` agent.
  await expect.element(screen.getByTestId("ck-chat")).toBeInTheDocument();

  // The assembled prompt is available (collapsed in <details>, shown via the
  // shared CodeBlock as markdown source).
  expect(document.querySelector('code[class*="language-"]')?.textContent).toContain("# Hello");
});

test("forwards the runtime headers to the CopilotKit provider verbatim", async () => {
  providerSpy.mockClear();
  await render(
    <TutorChat
      code={TUTOR_CODE}
      threadId={THREAD_ID}
      tutorUrl={TUTOR_URL}
      runtimeHeaders={RUNTIME_HEADERS}
      prompt="p"
      warnings={[]}
      imageInput={false}
      description="Beschreibung des Tutors"
    />,
  );

  expect(providerSpy.mock.lastCall?.[0]).toMatchObject({
    runtimeUrl: "/api/copilotkit",
    headers: RUNTIME_HEADERS,
  });
});

test("pins the server-generated threadId on CopilotChat and re-enables the welcome screen", async () => {
  chatSpy.mockClear();
  viewSpy.mockClear();
  await render(
    <TutorChat
      code={TUTOR_CODE}
      threadId={THREAD_ID}
      tutorUrl={TUTOR_URL}
      runtimeHeaders={RUNTIME_HEADERS}
      prompt="p"
      warnings={[]}
      imageInput={false}
      description="Beschreibung des Tutors"
    />,
  );

  // The id goes through CopilotChat's `threadId` prop (explicit mode — the
  // only mode where the pinned thread reliably carries the conversation).
  expect(chatSpy.mock.lastCall?.[0].threadId).toBe(THREAD_ID);

  // Explicit mode suppresses the view's welcome screen (tutor title,
  // description, example questions) — the chatView wrapper must override the
  // two flags that gate it, no matter what CopilotChat passes down.
  const ChatView = chatSpy.mock.lastCall?.[0].chatView;
  await render(<ChatView hasExplicitThreadId={true} isConnecting={true} />);
  expect(viewSpy.mock.lastCall?.[0]).toMatchObject({
    hasExplicitThreadId: false,
    isConnecting: false,
  });
});

test("shows warnings from the tutor build in the preview", async () => {
  const screen = await render(
    <TutorChat
      code={TUTOR_CODE}
      threadId={THREAD_ID}
      tutorUrl={TUTOR_URL}
      runtimeHeaders={RUNTIME_HEADERS}
      prompt="prompt"
      warnings={[{ code: "UNDECLARED_VARIABLE", message: "Variable foo is not declared" }]}
      imageInput={false}
      description="Beschreibung des Tutors"
    />,
  );

  await expect.element(screen.getByText("UNDECLARED_VARIABLE")).toBeInTheDocument();
});

test("enables image attachments (images only, 5 MB cap) when the tutor opts in", async () => {
  chatSpy.mockClear();
  await render(
    <TutorChat
      code={TUTOR_CODE}
      threadId={THREAD_ID}
      tutorUrl={TUTOR_URL}
      runtimeHeaders={RUNTIME_HEADERS}
      prompt="p"
      warnings={[]}
      imageInput={true}
      description="Beschreibung des Tutors"
    />,
  );

  expect(chatSpy.mock.lastCall?.[0].attachments).toMatchObject({
    enabled: true,
    accept: "image/*",
    maxSize: 5 * 1024 * 1024,
  });
  expect(chatSpy.mock.lastCall?.[0].attachments.onUploadFailed).toBeTypeOf("function");
});

test("passes no attachments config when the tutor does not opt in", async () => {
  chatSpy.mockClear();
  await render(
    <TutorChat
      code={TUTOR_CODE}
      threadId={THREAD_ID}
      tutorUrl={TUTOR_URL}
      runtimeHeaders={RUNTIME_HEADERS}
      prompt="p"
      warnings={[]}
      imageInput={false}
      description="Beschreibung des Tutors"
    />,
  );

  expect(chatSpy.mock.lastCall?.[0].attachments).toBeUndefined();
});

test("passes the tutor title as the welcome greeting label", async () => {
  chatSpy.mockClear();
  await render(
    <TutorChat
      code={TUTOR_CODE}
      threadId={THREAD_ID}
      tutorUrl={TUTOR_URL}
      runtimeHeaders={RUNTIME_HEADERS}
      prompt="p"
      warnings={[]}
      imageInput={false}
      title="Dein Tutor für verkettete Listen"
      description="Beschreibung des Tutors"
    />,
  );

  expect(chatSpy.mock.lastCall?.[0].labels).toEqual({
    welcomeMessageText: "Dein Tutor für verkettete Listen",
  });
});

test("keeps CopilotKit's default greeting when the tutor has no title", async () => {
  chatSpy.mockClear();
  await render(
    <TutorChat
      code={TUTOR_CODE}
      threadId={THREAD_ID}
      tutorUrl={TUTOR_URL}
      runtimeHeaders={RUNTIME_HEADERS}
      prompt="p"
      warnings={[]}
      imageInput={false}
      description="Beschreibung des Tutors"
    />,
  );

  expect(chatSpy.mock.lastCall?.[0].labels).toBeUndefined();
});

// TutorChat customizes the welcome screen through its chatView slot (the only
// way to reach the chat input's onInputChange). The stubbed CopilotChat never
// renders its slots itself, so tests drive the chain by hand: render the
// chatView component (which renders the stubbed CopilotChat.View and reports
// its props to viewSpy), then render the welcomeMessage sub-slot it composed.
async function renderWelcomeMessage(viewProps: Record<string, unknown> = {}) {
  viewSpy.mockClear();
  const ChatView = chatSpy.mock.lastCall?.[0].chatView;
  expect(ChatView).toBeTypeOf("function");
  await render(<ChatView {...viewProps} />);
  const WelcomeMessage = viewSpy.mock.lastCall?.[0].welcomeScreen?.welcomeMessage;
  expect(WelcomeMessage).toBeTypeOf("function");
  return render(<WelcomeMessage />);
}

test("the welcome screen slot composes the built-in greeting plus the description", async () => {
  chatSpy.mockClear();
  await render(
    <TutorChat
      code={TUTOR_CODE}
      threadId={THREAD_ID}
      tutorUrl={TUTOR_URL}
      runtimeHeaders={RUNTIME_HEADERS}
      prompt="p"
      warnings={[]}
      imageInput={false}
      description="Ich helfe dir Schritt für Schritt."
    />,
  );

  const screen = await renderWelcomeMessage();
  await expect.element(screen.getByTestId("ck-welcome-message")).toBeInTheDocument();
  await expect.element(screen.getByText("Ich helfe dir Schritt für Schritt.")).toBeInTheDocument();
});

const EXAMPLE_QUESTIONS = [
  { title: "Was ist eine Liste?", question: "Kannst du mir erklären, was eine Liste ist?" },
  { title: "Knoten einfügen", question: "Wie füge ich einen Knoten am Anfang ein?" },
];

test("example questions render as buttons with the question text as tooltip", async () => {
  chatSpy.mockClear();
  await render(
    <TutorChat
      code={TUTOR_CODE}
      threadId={THREAD_ID}
      tutorUrl={TUTOR_URL}
      runtimeHeaders={RUNTIME_HEADERS}
      prompt="p"
      warnings={[]}
      imageInput={false}
      description="Beschreibung des Tutors"
      exampleQuestions={EXAMPLE_QUESTIONS}
    />,
  );

  const screen = await renderWelcomeMessage();
  for (const { title, question } of EXAMPLE_QUESTIONS) {
    const button = screen.getByRole("button", { name: title });
    await expect.element(button).toBeVisible();
    await expect.element(button).toHaveAttribute("title", question);
  }
});

test("clicking an example question fills the chat input without sending", async () => {
  chatSpy.mockClear();
  await render(
    <TutorChat
      code={TUTOR_CODE}
      threadId={THREAD_ID}
      tutorUrl={TUTOR_URL}
      runtimeHeaders={RUNTIME_HEADERS}
      prompt="p"
      warnings={[]}
      imageInput={false}
      description="Beschreibung des Tutors"
      exampleQuestions={EXAMPLE_QUESTIONS}
    />,
  );

  const onInputChange = vi.fn();
  const onSubmitMessage = vi.fn();
  const screen = await renderWelcomeMessage({ onInputChange, onSubmitMessage });
  await screen.getByRole("button", { name: "Knoten einfügen" }).click();

  expect(onInputChange).toHaveBeenCalledExactlyOnceWith("Wie füge ich einen Knoten am Anfang ein?");
  // Filling the input must not submit the message.
  expect(onSubmitMessage).not.toHaveBeenCalled();
});

test("renders no question list when the tutor defines no example questions", async () => {
  chatSpy.mockClear();
  await render(
    <TutorChat
      code={TUTOR_CODE}
      threadId={THREAD_ID}
      tutorUrl={TUTOR_URL}
      runtimeHeaders={RUNTIME_HEADERS}
      prompt="p"
      warnings={[]}
      imageInput={false}
      description="Beschreibung des Tutors"
    />,
  );

  const screen = await renderWelcomeMessage();
  expect(screen.container.querySelector("ul")).toBeNull();
});

test("a failed upload shows a dismissible notice", async () => {
  chatSpy.mockClear();
  const screen = await render(
    <TutorChat
      code={TUTOR_CODE}
      threadId={THREAD_ID}
      tutorUrl={TUTOR_URL}
      runtimeHeaders={RUNTIME_HEADERS}
      prompt="p"
      warnings={[]}
      imageInput={true}
      description="Beschreibung des Tutors"
    />,
  );

  // Simulate CopilotKit rejecting a file (too large / wrong type): the chat
  // calls onUploadFailed, and TutorChat must surface the reason to the student.
  const attachments = chatSpy.mock.lastCall?.[0].attachments;
  if (!attachments) throw new Error("attachments config was not passed to CopilotChat");
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
