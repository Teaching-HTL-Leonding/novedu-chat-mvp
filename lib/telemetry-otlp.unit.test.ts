// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Only the NodeSDK class is replaced (recording its constructor argument, no-op
// start); the `resources` namespace and the instrumentation packages stay real
// so the detector set and the instrumentation defaults are the shipped ones.
const mocks = vi.hoisted(() => ({
  configurations: [] as unknown[],
  started: 0,
}));

vi.mock("@opentelemetry/sdk-node", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@opentelemetry/sdk-node")>();
  class FakeNodeSDK {
    constructor(configuration: unknown) {
      mocks.configurations.push(configuration);
    }
    start() {
      mocks.started += 1;
    }
  }
  return { ...actual, NodeSDK: FakeNodeSDK };
});

import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { RuntimeNodeInstrumentation } from "@opentelemetry/instrumentation-runtime-node";
import { type NodeSDKConfiguration, resources } from "@opentelemetry/sdk-node";
import {
  DEFAULT_SERVICE_NAME,
  OTLP_RESOURCE_DETECTORS,
  otlpInstrumentations,
  otlpSdkConfiguration,
  startOtlpSdk,
} from "@/lib/telemetry-otlp";

beforeEach(() => {
  mocks.configurations.length = 0;
  mocks.started = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resource detectors", () => {
  it("is the fixed env/host/os/serviceinstance set — never the process detector", () => {
    expect(OTLP_RESOURCE_DETECTORS).toEqual([
      resources.envDetector,
      resources.hostDetector,
      resources.osDetector,
      resources.serviceInstanceIdDetector,
    ]);
    expect(OTLP_RESOURCE_DETECTORS).not.toContain(resources.processDetector);
  });

  it("detects host/os/instance attributes and neither process.command_args nor process.owner", async () => {
    const resource = resources.detectResources({ detectors: OTLP_RESOURCE_DETECTORS });
    await resource.waitForAsyncAttributes?.();
    const attributes = resource.attributes;

    expect(attributes["host.name"]).toEqual(expect.any(String));
    expect(attributes["os.type"]).toEqual(expect.any(String));
    expect(attributes["service.instance.id"]).toEqual(expect.any(String));
    for (const key of Object.keys(attributes)) {
      expect(key, key).not.toMatch(/^process\./);
    }
  });
});

describe("instrumentations", () => {
  it("are exactly http, pg and runtime-node with bare defaults", () => {
    const list = otlpInstrumentations();
    expect(list.map((i) => i.constructor)).toEqual([
      HttpInstrumentation,
      PgInstrumentation,
      RuntimeNodeInstrumentation,
    ]);

    const http = list[0] as HttpInstrumentation;
    const pg = list[1] as PgInstrumentation;
    // No header capture, no bound-value capture — the privacy boundary of
    // docs/telemetry.md. (Bodies have no capture option at all.)
    expect(http.getConfig().headersToSpanAttributes).toBeUndefined();
    expect(pg.getConfig().enhancedDatabaseReporting).toBeFalsy();
  });
});

describe("otlpSdkConfiguration", () => {
  it("passes only instrumentations + detectors, leaving every signal to the SDK's env setup", () => {
    const configuration = otlpSdkConfiguration({ OTEL_SERVICE_NAME: "custom" });
    expect(Object.keys(configuration).sort()).toEqual(["instrumentations", "resourceDetectors"]);
    expect(configuration.resourceDetectors).toBe(OTLP_RESOURCE_DETECTORS);
  });

  it("defaults the service name to novedu-chat only when OTEL_SERVICE_NAME is blank", () => {
    expect(otlpSdkConfiguration({}).serviceName).toBe(DEFAULT_SERVICE_NAME);
    expect(otlpSdkConfiguration({ OTEL_SERVICE_NAME: "   " }).serviceName).toBe(
      DEFAULT_SERVICE_NAME,
    );
    expect(otlpSdkConfiguration({ OTEL_SERVICE_NAME: "custom" }).serviceName).toBeUndefined();
  });
});

describe("startOtlpSdk", () => {
  it("constructs the SDK from the configuration and starts it once", () => {
    vi.stubEnv("OTEL_SERVICE_NAME", "");
    const sdk = startOtlpSdk();
    expect(sdk).toBeDefined();
    expect(mocks.started).toBe(1);
    expect(mocks.configurations).toHaveLength(1);
    const configuration = mocks.configurations[0] as Partial<NodeSDKConfiguration>;
    expect(configuration.serviceName).toBe(DEFAULT_SERVICE_NAME);
    expect(configuration.resourceDetectors).toBe(OTLP_RESOURCE_DETECTORS);
    expect(configuration.instrumentations).toHaveLength(3);
    expect(configuration.traceExporter).toBeUndefined();
    expect(configuration.spanProcessors).toBeUndefined();
    expect(configuration.metricReaders).toBeUndefined();
    expect(configuration.logRecordProcessors).toBeUndefined();
    expect(configuration.sampler).toBeUndefined();
  });
});
