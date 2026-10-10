// Novedu's fake LLM: an OpenAI-compatible stand-in for a real model, built on
// CopilotKit's aimock. It openly says it is fake — every default reply names
// itself. All behaviour lives in `fakeReply` (fake-llm/markers.mjs); this file
// only starts the server.
//
// Run directly: `node fake-llm/server.mjs`. Playwright starts it as the first
// `webServer` in fake mode and points the app's SCCH provider at it
// (playwright.config.ts, docs/testing.md "Fake LLM"). The port comes from
// FAKE_LLM_PORT, which the Playwright config sets from e2e/fake-llm.constants.ts.
//
// Every streamed reply is cut into small chunks with a fixed delay between
// them, so a run stays in flight long enough for the UI's transient
// "generating" note to be observable.

import { LLMock } from "@copilotkit/aimock";
import { fakeReply } from "./markers.mjs";

const port = Number(process.env.FAKE_LLM_PORT);
if (!Number.isInteger(port) || port <= 0) {
  console.error("fake-llm: set FAKE_LLM_PORT to the port to listen on.");
  process.exit(1);
}

const mock = new LLMock({
  host: "127.0.0.1",
  port,
  latency: 40,
  chunkSize: 10,
  // The request journal is never read; keep it from growing in a long run.
  journalMaxEntries: 1,
  logLevel: "warn",
});
mock.on({ predicate: () => true }, fakeReply);

await mock.start();
console.log(`fake-llm: listening on http://127.0.0.1:${port}/v1`);
