import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { mintTutorCode } from "./tutor-code.utils";

// The chat runtime accepts thread-touching requests only with a matching
// `x-thread-token` (HMAC over code/user/threadId, signed by the chat page —
// see lib/thread-token.ts). These specs forge requests with `page.request`
// (the student session cookie rides along, so the 401 gate passes) and expect
// the ownership check to reject them BEFORE anything reaches Mastra or the
// LLM. All of them mint a real code, hence @live.

const RUN_BODY = (threadId: string) => ({
  threadId,
  runId: "e2e-forged-run",
  messages: [],
  tools: [],
  context: [],
  state: {},
  forwardedProps: {},
});

test("a forged run with a bogus thread token is rejected", { tag: "@live" }, async ({ page }) => {
  const code = await mintTutorCode();

  const res = await page.request.post("/api/copilotkit/agent/tutor/run", {
    headers: { "x-tutor-code": code, "x-thread-token": "deadbeef" },
    data: RUN_BODY(randomUUID()),
  });

  expect(res.status()).toBe(403);
  expect((await res.json()).error).toMatch(/does not belong to your session/);
});

test("a run without a thread token is rejected", { tag: "@live" }, async ({ page }) => {
  const code = await mintTutorCode();

  const res = await page.request.post("/api/copilotkit/agent/tutor/run", {
    headers: { "x-tutor-code": code },
    data: RUN_BODY(randomUUID()),
  });

  expect(res.status()).toBe(403);
});

test("the runtime's thread endpoints are not exposed", { tag: "@live" }, async ({ page }) => {
  const code = await mintTutorCode();
  const headers = { "x-tutor-code": code };

  // CopilotKit's runtime would serve these (list, read messages) — the route
  // must 404 them: thread content is reachable through token-checked runs only.
  const list = await page.request.get("/api/copilotkit/threads", { headers });
  expect(list.status()).toBe(404);

  const messages = await page.request.get(`/api/copilotkit/threads/${randomUUID()}/messages`, {
    headers,
  });
  expect(messages.status()).toBe(404);
});
