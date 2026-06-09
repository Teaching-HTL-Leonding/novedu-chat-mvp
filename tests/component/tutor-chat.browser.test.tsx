import type { ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { TutorChat } from "@/app/tutor-chat";

// Stub CopilotKit's v2 chat: the real provider can't mount under the test
// runner's bundled React, and this suite verifies TutorChat's own form/chat
// transition — the live chat is exercised by the e2e test instead.
vi.mock("@copilotkit/react-core/v2", () => ({
  CopilotKitProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="ck-provider">{children}</div>
  ),
  CopilotChat: ({ agentId }: { agentId: string }) => <div data-testid="ck-chat">{agentId}</div>,
}));

const SAMPLE_URL = "https://example.com/tutor.yaml";

function mockFetchOnce(data: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ json: async () => data })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("a valid tutor switches to the chat view with a prompt preview", async () => {
  mockFetchOnce({
    ok: true,
    prompt: "# Hello\n\nMass-energy: $E=mc^2$.",
    model: "test/model",
    warnings: [],
  });
  const screen = await render(<TutorChat />);

  await screen.getByRole("textbox").fill(SAMPLE_URL);
  await screen.getByRole("button", { name: "Start" }).click();

  // The form is replaced by the chat view: a "Change tutor" control appears...
  await expect.element(screen.getByRole("button", { name: "Change tutor" })).toBeVisible();
  // ...and the assembled prompt is available (collapsed in <details>, shown via
  // the shared CodeBlock as markdown source).
  expect(document.querySelector('code[class*="language-"]')?.textContent).toContain("# Hello");
});

test("an invalid tutor stays on the form and renders the error list", async () => {
  mockFetchOnce({
    ok: false,
    errors: [{ code: "FRAGMENT_NOT_FOUND", message: "Fragment foo not found in file bar" }],
    warnings: [],
  });
  const screen = await render(<TutorChat />);

  await screen.getByRole("textbox").fill(SAMPLE_URL);
  await screen.getByRole("button", { name: "Start" }).click();

  await expect.element(screen.getByText("FRAGMENT_NOT_FOUND")).toBeVisible();
  await expect.element(screen.getByText("Fragment foo not found in file bar")).toBeVisible();
  // No chat view — the failed attempt keeps the form on screen.
  expect(document.querySelector(`[title="${SAMPLE_URL}"]`)).toBeNull();
});

test("shows a loading state while validation is in flight", async () => {
  let release: () => void = () => {};
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ json: async () => ({ ok: false, errors: [], warnings: [] }) });
        }),
    ),
  );

  const screen = await render(<TutorChat />);
  await screen.getByRole("textbox").fill(SAMPLE_URL);
  await screen.getByRole("button", { name: "Start" }).click();

  await expect.element(screen.getByRole("button", { name: "Loading…" })).toBeDisabled();
  release();
});
