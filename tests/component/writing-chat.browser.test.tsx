import type { ReactNode, RefObject } from "react";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

// The writing module's keystone: the read-only `getCurrentText` frontend tool.
// WritingChat is just the shared ModuleChat plus that one child, so this suite
// mocks ModuleChat away (asserting only the module-boundary props it hands over)
// and mocks `useFrontendTool` to capture the tool config — the provider/threadId/
// markdown wiring is owned by the module-chat test. The ModuleChat stub renders
// its `children`, which is what lets the tool registrar mount and call the hook.
const moduleChatSpy = vi.hoisted(() => vi.fn());
const frontendToolSpy = vi.hoisted(() => vi.fn());

vi.mock("@/app/module-chat", () => ({
  ModuleChat: ({ children, ...props }: { children?: ReactNode }) => {
    moduleChatSpy(props);
    return <div data-testid="module-chat">{children}</div>;
  },
}));

vi.mock("@copilotkit/react-core/v2", () => ({
  useFrontendTool: (config: unknown, deps: unknown) => {
    frontendToolSpy(config, deps);
  },
}));

// WritingChat mounts the shared ReportButton, which statically imports the report
// server actions; mock them so the browser bundle doesn't pull next/cache.
vi.mock("@/lib/report-actions", () => ({ submitChatReport: vi.fn(), submitQuizReport: vi.fn() }));

import { WritingChat } from "@/app/[code]/_writing/writing-chat";

const CODE = "a1b2c3d4e5";
const THREAD_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const RUNTIME_HEADERS = {
  "x-code": CODE,
  "x-thread-token": "deadbeef".repeat(8),
};

function renderChat(currentTextRef: RefObject<string>) {
  return render(
    <WritingChat
      code={CODE}
      threadId={THREAD_ID}
      runtimeHeaders={RUNTIME_HEADERS}
      currentTextRef={currentTextRef}
    />,
  );
}

test("registers the read-only getCurrentText tool on the writing agent (no parameters)", async () => {
  frontendToolSpy.mockClear();
  await renderChat({ current: "" });

  const config = frontendToolSpy.mock.lastCall?.[0];
  expect(config.name).toBe("getCurrentText");
  expect(config.agentId).toBe("writing");
  // Read-only by construction: the tool takes no arguments and there is no write
  // tool anywhere, so the chat can never mutate the student's draft.
  expect(config).not.toHaveProperty("parameters");
});

test("the handler returns the LIVE draft with length stats, not a stale closure", async () => {
  frontendToolSpy.mockClear();
  // The parent surface keeps this ref in sync with the editor buffer; the handler
  // must read through it on every call, never capture the value at mount time.
  const currentTextRef: RefObject<string> = { current: "draft A" };
  await renderChat(currentTextRef);

  const config = frontendToolSpy.mock.lastCall?.[0];
  // The result carries the live text plus computed length stats (for checking a
  // prompt's word/character requirements).
  await expect(config.handler()).resolves.toMatchObject({
    text: "draft A",
    words: 2,
    paragraphs: 1,
  });

  // Mutating the same ref (as the editor would) changes both the text AND the stats.
  currentTextRef.current = "draft B now";
  await expect(config.handler()).resolves.toMatchObject({ text: "draft B now", words: 3 });
});

test("hands ModuleChat the writing module-boundary props", async () => {
  moduleChatSpy.mockClear();
  await renderChat({ current: "" });

  expect(moduleChatSpy.mock.lastCall?.[0]).toMatchObject({
    agentId: "writing",
    providerKey: CODE,
    threadId: THREAD_ID,
    headers: RUNTIME_HEADERS,
  });
});
