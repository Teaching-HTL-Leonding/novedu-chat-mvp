// Single source of truth for the fake LLM's address (fake-llm/server.mjs).
// playwright.config.ts starts the server with FAKE_LLM_PORT set from here and
// points the app's SCCH provider at FAKE_LLM_BASE. Change the port HERE only.

export const FAKE_LLM_PORT = 34568;
export const FAKE_LLM_BASE = `http://127.0.0.1:${FAKE_LLM_PORT}/v1`;
