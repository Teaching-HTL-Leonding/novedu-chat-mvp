import { createOpenAI } from "@ai-sdk/openai";
import { SCCH_PROVIDER_NAME } from "@/lib/llm/provider";
import { scchAuthHeader, scchModelsUrl } from "@/lib/scch-endpoint";

// Our self-hosted vLLM GPU server exposes an OpenAI-compatible API.
// Base URL + key live in `.env` (SCCH_BASE_URL, SCCH_API_KEY) and never reach
// the browser — only this server-side module talks to the endpoint. The URL + auth
// header are built by the shared, side-effect-free `lib/scch-endpoint` (the same shape
// the coding proxy uses), so the two can never disagree.
const BASE_URL = process.env.SCCH_BASE_URL;
const API_KEY = process.env.SCCH_API_KEY;

// `.chat()` pins the Chat Completions API. The default `provider(id)` in
// @ai-sdk/openai v2 targets the newer Responses API, which vLLM does not serve.
// Exported so `lib/llm/model.ts` can resolve an activity's `llm.model` against
// this self-hosted endpoint (the API key never leaves the server). The `name` is
// the metering contract — see lib/llm/provider.ts.
export const scchProvider = createOpenAI({
  name: SCCH_PROVIDER_NAME,
  baseURL: BASE_URL,
  apiKey: API_KEY,
});

// The endpoint also hosts embedding / speech / audio models that can't drive a
// chat. Keep them out of the chat model dropdown.
const NON_CHAT = /embedding|multilingual-e5|voxtral|chatterbox/i;

export interface ScchModel {
  /** Sanitized id — safe as a Mastra agent key and a CopilotKit `agentId`. */
  id: string;
  /** Raw model id as reported by the vLLM `/v1/models` endpoint. */
  model: string;
  /** Human-friendly label for the dropdown. */
  label: string;
}

// Agent keys / agentIds must be free of slashes and dots (e.g. the raw id
// "Qwen/Qwen3.6-27B-FP8"). Map every unsafe char to an underscore.
const sanitize = (modelId: string) => modelId.replace(/[^A-Za-z0-9_-]/g, "_");

async function fetchModels(): Promise<ScchModel[]> {
  if (!BASE_URL || !API_KEY) {
    console.warn("[SCCH] SCCH_BASE_URL or SCCH_API_KEY not set — no SCCH models.");
    return [];
  }
  try {
    // Env is set (guarded above), so these getters won't throw.
    const res = await fetch(scchModelsUrl(), {
      headers: { Authorization: scchAuthHeader() },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { data: { id: string }[] };
    return json.data
      .map((m) => m.id)
      .filter((id) => !NON_CHAT.test(id))
      .sort((a, b) => a.localeCompare(b))
      .map((model) => ({ id: sanitize(model), model, label: model }));
  } catch (err) {
    console.warn(`[SCCH] Failed to list models: ${(err as Error).message}`);
    return [];
  }
}

// Resolved once when the server module loads — fetching it also confirms the
// endpoint is reachable. The tutor agent resolves a tutor's `llm.model` straight
// through `scchProvider`; we no longer build one agent per model.
export const scchModels: ScchModel[] = await fetchModels();
