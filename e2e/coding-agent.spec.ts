import { loadEnvConfig } from "@next/env";
import { expect, test } from "@playwright/test";
import {
  deleteCode,
  deleteCodingKeysByCode,
  LIVE_CODING_URL,
  mintCode,
  mintCodingKey,
} from "./code.utils";
import { fetchServedModel, type PiAgentResult, runPiAgent } from "./pi-agent.utils";

// A REAL external coding agent (pi, the engine under little-coder) talking to
// the coding module's public OpenAI-compatible endpoint, once per LLM PROVIDER:
// mint a coding code, mint a per-user API key for it (`novedu_coding_keys`,
// exactly like a student's `/{code}` visit would), point pi at the proxy with
// that key, and assert a non-empty answer comes back. Then ask the endpoint which model
// actually served the completion (the upstream's own `model` field, piped back
// unparsed) — so a silently failed per-code LLM override FAILS the test instead
// of passing with the wrong upstream's reply. This is the only e2e coverage of
// the override pair on the public coding route.
//
// Chat smoke only (`--no-tools`): SCCH models have produced malformed tool-call
// markup before, and the acceptance criterion is "non-empty response" —
// tool-call passthrough stays covered by the route integration test
// (app/api/coding/v1/chat/completions/route.unit.test.ts).
//
// No browser page is used — the Playwright webServer entries (dev server +
// fixtures server) provide everything.

// Read the dev server's .env the way Next does, so the Foundry skip mirrors
// exactly what the server sees.
loadEnvConfig(process.cwd());

// A full pi round-trip (fixture fetch + Next compile + the model) — give it room.
test.setTimeout(120_000);

// Best-effort cleanup: `deleteCode` drops only the code row, so the minted KEY
// rows are removed explicitly (a raw code delete does NOT cascade to
// `novedu_coding_keys` the way the app's own delete transaction does). Cleaned
// even on a mid-test failure so no live credential leaks into the shared dev
// database.
let mintedCode: string | null = null;

test.afterEach(async () => {
  if (!mintedCode) return;
  const code = mintedCode;
  mintedCode = null;
  try {
    await deleteCodingKeysByCode(code);
    await deleteCode(code);
  } catch {
    // best-effort
  }
});

// On a failed run the report must show WHY (a 401 from a bad mint, a 403
// window, a 502 fixture fetch, a provider error) — attach pi's full output.
async function attachPiOutput(result: PiAgentResult): Promise<void> {
  await test.info().attach("pi-stdout", { body: result.stdout, contentType: "text/plain" });
  await test.info().attach("pi-stderr", { body: result.stderr, contentType: "text/plain" });
}

// The raw completion JSON behind the model-identity check, for the same reason.
async function attachServedCompletion(raw: string): Promise<void> {
  await test
    .info()
    .attach("served-model-completion", { body: raw, contentType: "application/json" });
}

// @live: needs the real SCCH endpoint + Azure SQL — excluded in CI (test:e2e:ci).
test("pi gets a non-empty reply through the coding proxy", {
  tag: ["@live", "@live-llm"],
}, async () => {
  const code = await mintCode({
    module: "coding",
    file: LIVE_CODING_URL,
    note: "e2e pi agent (SCCH)",
  });
  mintedCode = code;
  const apiKey = await mintCodingKey({ code });

  const result = await runPiAgent({ apiKey, prompt: "Reply with exactly one word." });
  await attachPiOutput(result);
  expect(result.exitCode).toBe(0);
  expect(result.stdout.trim().length).toBeGreaterThan(0);

  // The upstream must be the fixture's pinned SCCH model, not some fallback.
  const served = await fetchServedModel(apiKey);
  await attachServedCompletion(served.raw);
  expect(served.model.toLowerCase()).toContain("gemma");
});

test.describe("via Azure Foundry", () => {
  // The SAME SCCH fixture — the code's LLM override pair does the provider
  // switching, keeping the environment-specific Foundry deployment name out of
  // the content-stable fixture tree (the tutor-chat-reply.spec.ts reasoning).

  // @live: needs the Foundry endpoint (MI / `az login` with the Cognitive
  // Services OpenAI User role) + Azure SQL — excluded in CI (test:e2e:ci).
  test("pi gets a non-empty reply from the overridden Foundry model", {
    tag: ["@live", "@live-llm"],
  }, async () => {
    test.skip(!process.env.AZURE_FOUNDRY_ENDPOINT, "AZURE_FOUNDRY_ENDPOINT is not set");

    const code = await mintCode({
      module: "coding",
      file: LIVE_CODING_URL,
      llm: { provider: "Azure Foundry", model: "gpt-5.4-mini" },
      note: "e2e pi agent (Foundry)",
    });
    mintedCode = code;
    const apiKey = await mintCodingKey({ code });

    const result = await runPiAgent({ apiKey, prompt: "Reply with exactly one word." });
    await attachPiOutput(result);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim().length).toBeGreaterThan(0);

    // If the override silently fell back to the YAML default this reports
    // `gemma…` — the test must fail loudly, not pass on the wrong upstream.
    const served = await fetchServedModel(apiKey);
    await attachServedCompletion(served.raw);
    expect(served.model.toLowerCase()).toContain("gpt-5.4-mini");
  });
});
