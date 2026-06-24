import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";

// The student writing surface (app/[code]/_writing/writing-surface.tsx): a split
// screen with the Markdown editor on the left and a collapsible feedback chat on
// the right. These specs pin the pure client behaviour — prefill, the collapse
// toggle, the Save button shown ONLY for an attributed (non-anonymous) activity,
// the dirty/unsaved state, and the "read formatted" lightbox rendering SANITIZED
// Markdown. The heavy deps (CodeMirror, the CopilotKit chat) are mocked; the
// saveWriting server action is mocked; the real MarkdownRenderer is kept so the
// sanitization assertion exercises the actual renderer student text flows through.

const saveWriting = vi.hoisted(() => vi.fn());
vi.mock("@/lib/writing-actions", () => ({ saveWriting }));

// A plain textarea stands in for the CodeMirror editor so the test can drive the
// buffer with a normal control.
vi.mock("@/app/files/yaml-editor", () => ({
  YamlEditor: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (v: string) => void;
    language?: string;
  }) => (
    <textarea
      aria-label="Editor"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

// The chat pulls in CopilotKit (cannot mount under the test runner's bundled
// React); a marker stub proves it is rendered only when the panel is open.
vi.mock("@/app/[code]/_writing/writing-chat", () => ({
  WritingChat: () => <div data-testid="writing-chat">chat</div>,
}));

import { WritingSurface } from "@/app/[code]/_writing/writing-surface";

const CODE = "a1b2c3d4e5";
const THREAD_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const RUNTIME_HEADERS = { "x-code": CODE, "x-thread-token": "deadbeef".repeat(8) };

function renderSurface(props: { anonymous: boolean; initialText?: string; placeholder?: string }) {
  return render(
    <WritingSurface
      code={CODE}
      threadId={THREAD_ID}
      runtimeHeaders={RUNTIME_HEADERS}
      writing={{ title: "Write your essay", placeholder: props.placeholder }}
      anonymous={props.anonymous}
      initialText={props.initialText ?? ""}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  saveWriting.mockResolvedValue({ ok: true });
});

// The collapse-toggle spec renders two surfaces and the lightbox spec opens a
// native modal <dialog>; unmount every root between tests so a stray editor never
// makes the `name: "Editor"` lookup ambiguous.
afterEach(() => {
  cleanup();
});

test("prefills the editor with the student's saved text (attributed activity)", async () => {
  const screen = await renderSurface({ anonymous: false, initialText: "my saved draft" });
  const editor = screen.getByRole("textbox", { name: "Editor" });
  await expect.element(editor).toHaveValue("my saved draft");
});

test("falls back to the placeholder when there is no saved text", async () => {
  const screen = await renderSurface({ anonymous: false, placeholder: "Start here" });
  await expect.element(screen.getByRole("textbox", { name: "Editor" })).toHaveValue("Start here");
});

test("shows the Save button for a non-anonymous activity", async () => {
  const screen = await renderSurface({ anonymous: false, initialText: "x" });
  // 'Saved' because the buffer equals the saved baseline (not dirty).
  await expect.element(screen.getByRole("button", { name: "Saved" })).toBeVisible();
});

test("hides the Save button for an anonymous activity", async () => {
  const screen = await renderSurface({ anonymous: true });
  // No Save/Saved button at all for an anonymous activity.
  await expect.element(screen.getByRole("button", { name: "Read formatted" })).toBeVisible();
  expect(screen.getByRole("button", { name: /save/i }).query()).toBeNull();
});

test("collapses and re-expands the assistant chat", async () => {
  const screen = await renderSurface({ anonymous: false });
  // Default expanded: the chat stub is mounted.
  await expect.element(screen.getByTestId("writing-chat")).toBeInTheDocument();

  await screen.getByRole("button", { name: "Hide assistant" }).click();
  expect(screen.getByTestId("writing-chat").query()).toBeNull();

  await screen.getByRole("button", { name: "Show assistant" }).click();
  await expect.element(screen.getByTestId("writing-chat")).toBeInTheDocument();
});

test("editing makes the activity dirty, then Save clears it and calls the action", async () => {
  const screen = await renderSurface({ anonymous: false, initialText: "original" });
  const editor = screen.getByRole("textbox", { name: "Editor" });

  await editor.fill("original — edited");
  // Dirty: the button reads 'Save' and is enabled.
  const save = screen.getByRole("button", { name: "Save" });
  await expect.element(save).toBeEnabled();

  await save.click();
  expect(saveWriting).toHaveBeenCalledWith({ code: CODE, text: "original — edited" });
  // After a successful save the dirty flag settles back to 'Saved'.
  await expect.element(screen.getByRole("button", { name: "Saved" })).toBeVisible();
});

test("surfaces a save error from the action", async () => {
  saveWriting.mockResolvedValue({ ok: false, message: "Could not save your text." });
  const screen = await renderSurface({ anonymous: false, initialText: "x" });
  const editor = screen.getByRole("textbox", { name: "Editor" });
  await editor.fill("x changed");
  await screen.getByRole("button", { name: "Save" }).click();
  await expect.element(screen.getByRole("alert")).toHaveTextContent("Could not save your text.");
});

test("the 'Read formatted' lightbox renders the buffer as SANITIZED Markdown", async () => {
  const screen = await renderSurface({
    anonymous: false,
    initialText: "# Heading\n\n<script>window.__pwned = 1;</script>",
  });

  await screen.getByRole("button", { name: "Read formatted" }).click();

  // The Markdown heading renders…
  await expect.element(screen.getByRole("heading", { name: "Heading" })).toBeVisible();
  // …but the injected <script> never becomes a live element (no rehype-raw).
  expect(document.querySelector("dialog script")).toBeNull();
  expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
});
