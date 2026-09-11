// @vitest-environment node
import { trace } from "@opentelemetry/api";
import type { NodeSDK } from "@opentelemetry/sdk-node";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  logsOf,
  metricNamesOf,
  type OtlpReceiver,
  resourcesOf,
  spansOf,
  startOtlpReceiver,
} from "../tests/otlp-receiver";

// The one end-to-end check of the standard path: the REAL NodeSDK, configured
// from environment variables exactly as in production, exporting to an
// in-process receiver. Its own file on purpose — the SDK registers global
// providers that cannot be replaced within a worker, and Vitest's per-file
// isolation keeps them from leaking. Because the receiver shares the process,
// instrumentation-http also records SERVER spans for the export POSTs
// themselves; that noise stops at shutdown and the assertions filter by name.

let receiver: OtlpReceiver;
let sdk: NodeSDK;

beforeAll(async () => {
  receiver = await startOtlpReceiver();
  vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", receiver.url);
  vi.stubEnv("OTEL_EXPORTER_OTLP_PROTOCOL", "http/json");
  vi.stubEnv("OTEL_SERVICE_NAME", "");
  vi.stubEnv("OTEL_LOG_LEVEL", "");
  vi.resetModules();
  const { startOtlpSdk } = await import("@/lib/telemetry-otlp");
  sdk = startOtlpSdk();

  const { emitEvent, recordError } = await import("@/lib/telemetry");
  trace.getTracer("delivery-test").startSpan("probe-span").end();
  emitEvent("probe_event", { kind: "test", count: 2 });
  recordError(new Error("probe failure"), { "novedu.area": "test" });
  // Let runtime-node take a few samples (10 ms precision) before the final
  // collection that shutdown forces.
  await new Promise((resolve) => setTimeout(resolve, 300));
  // shutdown() flushes the batch processors and forces one last metric export,
  // so no batch-delay tuning is needed for deterministic assertions.
  await sdk.shutdown();
}, 30_000);

afterAll(async () => {
  await receiver.close();
  vi.unstubAllEnvs();
});

describe("OTLP delivery from environment configuration", () => {
  it("delivers all three signals to the standard paths", () => {
    const paths = new Set(receiver.requests.map((r) => r.path));
    expect(paths).toContain("/v1/traces");
    expect(paths).toContain("/v1/logs");
    expect(paths).toContain("/v1/metrics");
  });

  it("names the service novedu-chat by default and exports no process attributes", () => {
    const resources = resourcesOf(receiver.requests);
    expect(resources.length).toBeGreaterThan(0);
    for (const resource of resources) {
      expect(resource["service.name"]).toBe(JSON.stringify({ stringValue: "novedu-chat" }));
      expect(resource["service.instance.id"]).toBeDefined();
      for (const key of Object.keys(resource)) {
        expect(key, key).not.toMatch(/^process\./);
      }
    }
  });

  it("exports the probe span and the root exception span", () => {
    const spans = spansOf(receiver.requests);
    expect(spans.map((s) => s.name)).toContain("probe-span");
    const exception = spans.find((s) => s.name === "exception");
    expect(exception).toBeDefined();
    expect(exception?.attributes["novedu.area"]).toBe(JSON.stringify({ stringValue: "test" }));
  });

  it("exports the event with the name as body and as eventName", () => {
    const record = logsOf(receiver.requests).find(
      (r) => JSON.stringify(r.body) === JSON.stringify({ stringValue: "probe_event" }),
    );
    expect(record).toBeDefined();
    expect(record?.eventName).toBe("probe_event");
    expect(record?.attributes["microsoft.custom_event.name"]).toBe(
      JSON.stringify({ stringValue: "probe_event" }),
    );
    expect(record?.attributes.kind).toBe(JSON.stringify({ stringValue: "test" }));
  });

  it("exports the runtime-node event-loop / V8 measurements", () => {
    const names = metricNamesOf(receiver.requests);
    expect(names.some((n) => n.startsWith("nodejs.") || n.startsWith("v8js."))).toBe(true);
  });
});
