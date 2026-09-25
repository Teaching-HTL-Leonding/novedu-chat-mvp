// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { providerHostMap } from "@/lib/diagnostics-hosts";
import { providerForHost } from "@/lib/diagnostics-shape";

// Hosts come from the configured provider endpoints, never from literals: an
// unconfigured provider is simply absent and its calls read as "other".

afterEach(() => {
  vi.unstubAllEnvs();
});

function stub(env: Record<string, string>) {
  for (const key of ["SCCH_BASE_URL", "AZURE_FOUNDRY_ENDPOINT", "OPENROUTER_BASE_URL"]) {
    vi.stubEnv(key, env[key] ?? "");
  }
}

describe("providerHostMap", () => {
  it("maps every configured provider's host", () => {
    stub({
      SCCH_BASE_URL: "https://llm2go-api.scch.at/v1",
      AZURE_FOUNDRY_ENDPOINT: "https://oai-demo.openai.azure.com/",
      OPENROUTER_BASE_URL: "https://gateway.example.org/api/v1",
    });
    expect(providerHostMap()).toEqual({
      "llm2go-api.scch.at": "SCCH",
      "oai-demo.openai.azure.com": "Azure Foundry",
      "gateway.example.org": "OpenRouter",
    });
  });

  it("skips unconfigured providers without throwing (OpenRouter has a default host)", () => {
    stub({});
    expect(providerHostMap()).toEqual({ "openrouter.ai": "OpenRouter" });
  });

  it("normalises case, port and a trailing dot", () => {
    stub({ SCCH_BASE_URL: "https://LLM2GO-API.scch.at.:8443/v1" });
    const map = providerHostMap();
    expect(map["llm2go-api.scch.at"]).toBe("SCCH");
    expect(providerForHost("LLM2GO-API.SCCH.AT.", map)).toBe("SCCH");
  });
});

describe("providerForHost", () => {
  it("labels an unknown host as other", () => {
    expect(providerForHost("api.unknown.example", { "llm2go-api.scch.at": "SCCH" })).toBe("other");
    expect(providerForHost("", {})).toBe("other");
  });
});
