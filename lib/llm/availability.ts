import { foundryConfigured } from "@/lib/llm/foundry-endpoint";
import { openrouterConfigured } from "@/lib/llm/openrouter-endpoint";
import type { LlmProvider } from "@/lib/llm/provider";

// The ONE place that answers "can THIS server actually serve this provider?" —
// the availability counterpart to the two resolvers (lib/llm/model.ts,
// lib/llm/endpoint.ts). Consumed by the app's authoring gate
// (lib/file-validators.ts) and the runtime guards (code-module
// buildRequestContext, the tutor loader), so a Foundry activity on an SCCH-only
// deployment fails at save time / with a clean message instead of erroring
// mid-chat.
//
// SERVER-ONLY and APP-ONLY: the @novedu/cli bundles the loadAndCheck* validation
// core, which must stay env-free — this module is deliberately NOT imported from
// there, so CLI validation of provider-carrying YAML works on any machine.

/** `null` when the provider is usable on this server; a teacher-readable reason otherwise. */
export function providerUnavailableReason(provider: LlmProvider): string | null {
  if (provider === "Azure Foundry" && !foundryConfigured()) {
    return (
      'This activity uses the "Azure Foundry" LLM provider, which is not configured on ' +
      "this server (AZURE_FOUNDRY_ENDPOINT is not set). Switch llm.provider to SCCH or " +
      "ask the operator to configure Azure Foundry."
    );
  }
  if (provider === "OpenRouter" && !openrouterConfigured()) {
    return (
      'This activity uses the "OpenRouter" LLM provider, which is not configured on ' +
      "this server (OPENROUTER_API_KEY is not set). Switch llm.provider to SCCH or " +
      "ask the operator to configure OpenRouter."
    );
  }
  return null;
}
