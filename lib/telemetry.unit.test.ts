// @vitest-environment node
import { context, TraceFlags, trace } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { logs as sdkLogs, node as sdkNode } from "@opentelemetry/sdk-node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Both initializer boundaries are mocked; the facade's own logic (selection,
// idempotency, failure caching, log hygiene) is what is under test. The event
// and error helpers are exercised against REAL in-memory providers from the
// SDK so the record/span shapes are the ones a receiver sees.
const mocks = vi.hoisted(() => ({
  startAzureMonitor: vi.fn(),
  startOtlpSdk: vi.fn(),
}));
vi.mock("@/lib/telemetry-azure", () => ({ startAzureMonitor: mocks.startAzureMonitor }));
vi.mock("@/lib/telemetry-otlp", () => ({ startOtlpSdk: mocks.startOtlpSdk }));

const OTLP = "http://collector.internal:4318";
const AZURE = "InstrumentationKey=abc-123;IngestionEndpoint=https://ingest.example";

async function freshFacade() {
  vi.resetModules();
  return import("@/lib/telemetry");
}

let warn: ReturnType<typeof vi.spyOn>;
let log: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("OTEL_SDK_DISABLED", "");
  vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "");
  vi.stubEnv("APPLICATIONINSIGHTS_CONNECTION_STRING", "");
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  log = vi.spyOn(console, "log").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function allOutput(): string {
  return [...warn.mock.calls, ...log.mock.calls, ...error.mock.calls]
    .map((call) => call.map(String).join(" "))
    .join("\n");
}

describe("initTelemetry selection", () => {
  it("starts the OTLP backend only, when the endpoint is set", async () => {
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", OTLP);
    const { initTelemetry } = await freshFacade();
    await expect(initTelemetry()).resolves.toBe("otlp");
    expect(mocks.startOtlpSdk).toHaveBeenCalledTimes(1);
    expect(mocks.startAzureMonitor).not.toHaveBeenCalled();
    expect(allOutput()).toContain("telemetry: mode=otlp");
    expect(allOutput()).not.toContain(OTLP);
  });

  it("starts Azure Monitor only, with the trimmed connection string", async () => {
    vi.stubEnv("APPLICATIONINSIGHTS_CONNECTION_STRING", `  ${AZURE}  `);
    const { initTelemetry } = await freshFacade();
    await expect(initTelemetry()).resolves.toBe("azure");
    expect(mocks.startAzureMonitor).toHaveBeenCalledWith(AZURE);
    expect(mocks.startOtlpSdk).not.toHaveBeenCalled();
    expect(allOutput()).toContain("telemetry: mode=azure");
    expect(allOutput()).not.toContain("InstrumentationKey");
  });

  it("prefers OTLP when both destinations are configured", async () => {
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", OTLP);
    vi.stubEnv("APPLICATIONINSIGHTS_CONNECTION_STRING", AZURE);
    const { initTelemetry } = await freshFacade();
    await expect(initTelemetry()).resolves.toBe("otlp");
    expect(mocks.startAzureMonitor).not.toHaveBeenCalled();
  });

  it("OTEL_SDK_DISABLED=true starts nothing even with both destinations", async () => {
    vi.stubEnv("OTEL_SDK_DISABLED", "true");
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", OTLP);
    vi.stubEnv("APPLICATIONINSIGHTS_CONNECTION_STRING", AZURE);
    const { initTelemetry } = await freshFacade();
    await expect(initTelemetry()).resolves.toBe("disabled");
    expect(mocks.startOtlpSdk).not.toHaveBeenCalled();
    expect(mocks.startAzureMonitor).not.toHaveBeenCalled();
    expect(allOutput()).toContain("telemetry: disabled (OTEL_SDK_DISABLED=true)");
  });

  it("is disabled with nothing configured and starts no backend", async () => {
    const { initTelemetry } = await freshFacade();
    await expect(initTelemetry()).resolves.toBe("disabled");
    expect(mocks.startOtlpSdk).not.toHaveBeenCalled();
    expect(mocks.startAzureMonitor).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("initTelemetry idempotency", () => {
  it("shares one bring-up across concurrent and repeated calls", async () => {
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", OTLP);
    const { initTelemetry } = await freshFacade();
    const results = await Promise.all([initTelemetry(), initTelemetry()]);
    const third = await initTelemetry();
    expect([...results, third]).toEqual(["otlp", "otlp", "otlp"]);
    expect(mocks.startOtlpSdk).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("caches a disabled outcome and never re-evaluates the environment", async () => {
    const { initTelemetry } = await freshFacade();
    await expect(initTelemetry()).resolves.toBe("disabled");
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", OTLP);
    await expect(initTelemetry()).resolves.toBe("disabled");
    expect(mocks.startOtlpSdk).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("initTelemetry failure", () => {
  it("a failed OTLP start leaves telemetry off, never falls back to Azure, and redacts the endpoint", async () => {
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", OTLP);
    vi.stubEnv("APPLICATIONINSIGHTS_CONNECTION_STRING", AZURE);
    mocks.startOtlpSdk.mockImplementation(() => {
      throw new Error(`cannot reach ${OTLP} (${AZURE})`);
    });
    const { initTelemetry } = await freshFacade();
    await expect(initTelemetry()).resolves.toBe("disabled");
    await expect(initTelemetry()).resolves.toBe("disabled");
    expect(mocks.startOtlpSdk).toHaveBeenCalledTimes(1);
    expect(mocks.startAzureMonitor).not.toHaveBeenCalled();

    const output = allOutput();
    expect(output).toContain("otlp initialization failed");
    expect(output).toContain("[redacted]");
    expect(output).not.toContain(OTLP);
    expect(output).not.toContain("InstrumentationKey");
    expect(log).not.toHaveBeenCalled();
  });

  it("a rejected dynamic import is handled the same way", async () => {
    vi.stubEnv("APPLICATIONINSIGHTS_CONNECTION_STRING", AZURE);
    mocks.startAzureMonitor.mockImplementation(() => {
      throw "not an Error instance";
    });
    const { initTelemetry } = await freshFacade();
    await expect(initTelemetry()).resolves.toBe("disabled");
    expect(allOutput()).toContain("not an Error instance");
  });
});

describe("helpers without initialization", () => {
  it("emitEvent and recordError are inert with no provider registered", async () => {
    const { emitEvent, recordError } = await freshFacade();
    expect(() => emitEvent("probe", { n: 1 })).not.toThrow();
    expect(() => recordError(new Error("x"))).not.toThrow();
    expect(() => recordError("plain string")).not.toThrow();
  });
});

describe("emitEvent record shape", () => {
  it("carries the name as body, as eventName and as the Azure custom-event attribute", async () => {
    const exporter = new sdkLogs.InMemoryLogRecordExporter();
    const provider = new sdkLogs.LoggerProvider({
      processors: [new sdkLogs.SimpleLogRecordProcessor({ exporter })],
    });
    logs.setGlobalLoggerProvider(provider);
    try {
      const { emitEvent } = await freshFacade();
      emitEvent("report.submitted", { kind: "chat", reaction: "up" });

      const records = exporter.getFinishedLogRecords();
      expect(records).toHaveLength(1);
      const record = records[0];
      expect(record.body).toBe("report.submitted");
      expect(record.eventName).toBe("report.submitted");
      expect(record.attributes).toEqual({
        "microsoft.custom_event.name": "report.submitted",
        kind: "chat",
        reaction: "up",
      });
    } finally {
      await provider.shutdown();
      logs.disable();
    }
  });
});

describe("recordError sampling", () => {
  it("exports a root exception span even when the ambient request span was dropped", async () => {
    const exporter = new sdkNode.InMemorySpanExporter();
    const provider = new sdkNode.NodeTracerProvider({
      sampler: new sdkNode.ParentBasedSampler({ root: new sdkNode.AlwaysOnSampler() }),
      spanProcessors: [new sdkNode.SimpleSpanProcessor(exporter)],
    });
    provider.register();
    try {
      const { recordError } = await freshFacade();
      // A parent context whose span was NOT sampled — what an errored route's
      // request span looks like to a child.
      const dropped = trace.setSpanContext(context.active(), {
        traceId: "0af7651916cd43dd8448eb211c80319c",
        spanId: "b7ad6b7169203331",
        traceFlags: TraceFlags.NONE,
        isRemote: false,
      });
      context.with(dropped, () => {
        // Control: an ordinary child inherits the dropped decision and never exports.
        trace.getTracer("control").startSpan("child").end();
        recordError(new Error("boom"), { path: "/x", routeType: "route" });
        recordError({ not: "an error" });
      });

      const spans = exporter.getFinishedSpans();
      expect(spans.map((s) => s.name)).toEqual(["exception", "exception"]);
      const [first, second] = spans;
      expect(first.parentSpanContext).toBeUndefined();
      expect(first.spanContext().traceId).not.toBe("0af7651916cd43dd8448eb211c80319c");
      expect(first.status.code).toBe(2); // SpanStatusCode.ERROR
      expect(first.status.message).toBe("boom");
      expect(first.attributes).toEqual({ path: "/x", routeType: "route" });
      expect(first.events.map((e) => e.name)).toEqual(["exception"]);
      expect(first.events[0].attributes?.["exception.message"]).toBe("boom");
      expect(second.status.message).toBe("[object Object]");
    } finally {
      await provider.shutdown();
      trace.disable();
    }
  });
});
