// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ useAzureMonitor: vi.fn() }));

// The distro boundary is mocked wholesale: loading it for real would register
// global providers and start exporters.
vi.mock("@azure/monitor-opentelemetry", () => ({ useAzureMonitor: mocks.useAzureMonitor }));

import { startAzureMonitor } from "@/lib/telemetry-azure";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("startAzureMonitor", () => {
  it("calls the distro once with the connection string and nothing else", () => {
    startAzureMonitor("InstrumentationKey=abc;IngestionEndpoint=https://x");

    expect(mocks.useAzureMonitor).toHaveBeenCalledTimes(1);
    // Exact shape: no resource, no instrumentation config, no sampler — the
    // distro's defaults (incl. Live Metrics) apply unchanged.
    expect(mocks.useAzureMonitor).toHaveBeenCalledWith({
      azureMonitorExporterOptions: {
        connectionString: "InstrumentationKey=abc;IngestionEndpoint=https://x",
      },
    });
  });
});
