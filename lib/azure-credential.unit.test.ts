// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

// The explicit credential chains: `az login` first, then the Managed Identity —
// never `DefaultAzureCredential` (see lib/azure-credential.ts for why).

const identity = vi.hoisted(() => ({
  AzureCliCredential: vi.fn(function (this: { kind: string; options: unknown }, options: unknown) {
    this.kind = "cli";
    this.options = options;
  }),
  ManagedIdentityCredential: vi.fn(function (this: { kind: string }) {
    this.kind = "mi";
  }),
  ChainedTokenCredential: vi.fn(function (this: { sources: unknown[] }, ...sources: unknown[]) {
    this.sources = sources;
  }),
}));

vi.mock("@azure/identity", () => identity);

import { buildMonitorCredential } from "@/lib/azure-credential";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildMonitorCredential", () => {
  it("chains the az CLI (ambient tenant) before the Managed Identity", () => {
    const credential = buildMonitorCredential() as unknown as {
      sources: { kind: string; options?: unknown }[];
    };
    expect(credential.sources.map((s) => s.kind)).toEqual(["cli", "mi"]);
    expect(credential.sources[0]?.options).toEqual({});
    expect(identity.ChainedTokenCredential).toHaveBeenCalledTimes(1);
  });
});
