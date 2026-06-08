import { createOpenAI } from "@ai-sdk/openai";
import { Agent } from "@mastra/core/agent";

// Our self-hosted vLLM GPU server exposes an OpenAI-compatible API.
// Base URL + key live in `.env` (SCCH_BASE_URL, SCCH_API_KEY) and never reach
// the browser — the model list is proxied through /api/models.
const BASE_URL = process.env.SCCH_BASE_URL;
const API_KEY = process.env.SCCH_API_KEY;

// `.chat()` pins the Chat Completions API. The default `provider(id)` in
// @ai-sdk/openai v2 targets the newer Responses API, which vLLM does not serve.
const provider = createOpenAI({ baseURL: BASE_URL, apiKey: API_KEY });

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
    const res = await fetch(`${BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
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

// Resolved once when the server module loads. Shared by the Mastra registry
// (which builds one agent per entry) and the /api/models route, so the dropdown
// values are guaranteed to match registered agent keys.
export const scchModels: ScchModel[] = await fetchModels();

// One lightweight chat agent per model. The dropdown switches CopilotChat's
// `agentId`, which @ag-ui/mastra resolves straight to the matching agent.
export function buildScchAgents(): Record<string, Agent> {
  return Object.fromEntries(
    scchModels.map((m) => [
      m.id,
      new Agent({
        id: m.id,
        name: m.label,
        instructions: "You are a helpful, concise assistant. Answer clearly and accurately.",
        model: provider.chat(m.model),
      }),
    ]),
  );
}
