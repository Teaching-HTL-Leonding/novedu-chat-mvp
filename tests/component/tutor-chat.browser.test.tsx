import type { ReactNode } from "react";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

// Stub CopilotKit's v2 chat: the real provider can't mount under the test
// runner's bundled React, and this suite verifies TutorChat's own rendering —
// the live chat is exercised by the e2e tests instead. The provider stub
// reports its props to a spy so we can assert the signed share parameters are
// forwarded as headers (the backend re-verifies them on every request).
const providerSpy = vi.hoisted(() => vi.fn());
const chatSpy = vi.hoisted(() => vi.fn());

vi.mock("@copilotkit/react-core/v2", () => ({
  CopilotKitProvider: ({ children, ...props }: { children: ReactNode }) => {
    providerSpy(props);
    return <div data-testid="ck-provider">{children}</div>;
  },
  CopilotChat: ({ agentId, ...props }: { agentId: string }) => {
    chatSpy({ agentId, ...props });
    return <div data-testid="ck-chat">{agentId}</div>;
  },
}));

import { TutorChat } from "@/app/tutor-chat";

const TUTOR_URL = "https://example.com/tutor.yaml";
const RUNTIME_HEADERS = {
  "x-tutor-url": TUTOR_URL,
  "x-share-start": "1700000000",
  "x-share-end": "1700003600",
  "x-share-sig": "abc123",
};

test("renders the chat with the tutor bar and prompt preview", async () => {
  const screen = await render(
    <TutorChat
      tutorUrl={TUTOR_URL}
      runtimeHeaders={RUNTIME_HEADERS}
      prompt={"# Hello\n\nMass-energy: $E=mc^2$."}
      warnings={[]}
      imageInput={false}
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
      tutorUrl={TUTOR_URL}
      runtimeHeaders={RUNTIME_HEADERS}
      prompt="p"
      warnings={[]}
      imageInput={false}
    />,
  );

  expect(providerSpy.mock.lastCall?.[0]).toMatchObject({
    runtimeUrl: "/api/copilotkit",
    headers: RUNTIME_HEADERS,
  });
});

test("shows warnings from the tutor build in the preview", async () => {
  const screen = await render(
    <TutorChat
      tutorUrl={TUTOR_URL}
      runtimeHeaders={RUNTIME_HEADERS}
      prompt="prompt"
      warnings={[{ code: "UNDECLARED_VARIABLE", message: "Variable foo is not declared" }]}
      imageInput={false}
    />,
  );

  await expect.element(screen.getByText("UNDECLARED_VARIABLE")).toBeInTheDocument();
});

test("enables image attachments (images only, 5 MB cap) when the tutor opts in", async () => {
  chatSpy.mockClear();
  await render(
    <TutorChat
      tutorUrl={TUTOR_URL}
      runtimeHeaders={RUNTIME_HEADERS}
      prompt="p"
      warnings={[]}
      imageInput={true}
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
      tutorUrl={TUTOR_URL}
      runtimeHeaders={RUNTIME_HEADERS}
      prompt="p"
      warnings={[]}
      imageInput={false}
    />,
  );

  expect(chatSpy.mock.lastCall?.[0].attachments).toBeUndefined();
});

test("a failed upload shows a dismissible notice", async () => {
  chatSpy.mockClear();
  const screen = await render(
    <TutorChat
      tutorUrl={TUTOR_URL}
      runtimeHeaders={RUNTIME_HEADERS}
      prompt="p"
      warnings={[]}
      imageInput={true}
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
