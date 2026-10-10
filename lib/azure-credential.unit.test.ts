import { describe, expect, it, vi } from "vitest";

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

import {
  buildCognitiveServicesCredential,
  buildDataStoreCredential,
  buildMonitorCredential,
} from "@/lib/azure-credential";

// The mocked module exports only the three credential classes of the chain, so a
// builder reaching for DefaultAzureCredential or a client-secret credential would
// throw on the missing export instead of building.
type Chain = { sources: { kind: string; options?: unknown }[] };

describe.each([
  ["buildMonitorCredential", buildMonitorCredential],
  ["buildCognitiveServicesCredential", buildCognitiveServicesCredential],
])("%s", (_name, build) => {
  it("chains the az CLI (ambient tenant) before the Managed Identity", () => {
    const credential = build() as unknown as Chain;
    expect(credential.sources.map((s) => s.kind)).toEqual(["cli", "mi"]);
    expect(credential.sources[0]?.options).toEqual({});
    expect(identity.ChainedTokenCredential).toHaveBeenCalledTimes(1);
  });
});

describe("buildDataStoreCredential", () => {
  it("chains the az CLI pinned to STORAGE_TENANT_ID before the Managed Identity", () => {
    vi.stubEnv("STORAGE_TENANT_ID", "tenant-1");
    const credential = buildDataStoreCredential() as unknown as Chain;
    expect(credential.sources.map((s) => s.kind)).toEqual(["cli", "mi"]);
    expect(credential.sources[0]?.options).toEqual({ tenantId: "tenant-1" });
  });

  it("leaves the az CLI on its ambient tenant when STORAGE_TENANT_ID is unset", () => {
    vi.stubEnv("STORAGE_TENANT_ID", "");
    const credential = buildDataStoreCredential() as unknown as Chain;
    expect(credential.sources[0]?.options).toEqual({});
  });
});
