import { type HostMap, normalizeHost } from "@/lib/diagnostics-shape";
import { resolveChatEndpoint } from "@/lib/llm/endpoint";
import { LLM_PROVIDERS, type LlmProvider } from "@/lib/llm/provider";

// Maps the host of an upstream LLM call (as App Insights records it) back to the
// provider name the diagnostics page shows (docs/diagnostics.md). The hosts come
// from the SAME endpoint resolver the coding proxy uses, so there is no provider
// branch here and no host literal anywhere: a provider whose endpoint is not
// configured on this server is simply absent, and its historical calls show up as
// "other". The map never leaves the server — the DTO carries names only.
//
// SERVER-ONLY: reads the provider endpoint settings.

export function providerHostMap(): HostMap {
  const map: Record<string, LlmProvider> = {};
  for (const provider of LLM_PROVIDERS) {
    try {
      const host = normalizeHost(new URL(resolveChatEndpoint(provider).url).hostname);
      if (host) map[host] = provider;
    } catch {
      // Not configured here (the SCCH/Foundry URL getters throw on a missing
      // setting) or not a URL — its calls fall back to "other".
    }
  }
  return map;
}
