// Standard OpenTelemetry backend — `@opentelemetry/sdk-node` exporting OTLP to
// whatever OTEL_EXPORTER_OTLP_ENDPOINT names (the Aspire dashboard locally; any
// OTLP receiver or Collector elsewhere). Loaded ONLY through the dynamic import
// in lib/telemetry.ts when the resolver picked "otlp".
//
// The SDK's own environment handling owns every exporter, processor, reader and
// sampler (protocol, headers, per-signal endpoints/exporters, timeouts, metric
// interval, OTEL_TRACES_SAMPLER, OTEL_LOG_LEVEL …): nothing explicit is passed
// for any signal, because supplying `traceExporter` / `spanProcessors`,
// `metricReaders` or `logRecordProcessors` would bypass that setup for the
// signal in question. Novedu sets exactly two things the SDK would get wrong on
// its own:
//
//   - the service name defaults to "novedu-chat" when OTEL_SERVICE_NAME is
//     blank (the config option overrides the env var, so it is passed only then);
//   - the resource detector set is FIXED to env, host, os, serviceinstance.
//     NodeSDK's default set (and OTEL_NODE_RESOURCE_DETECTORS=all) includes the
//     `process` detector, which exports `process.command_args` (the full argv)
//     and `process.owner` (the OS username). Never add it. An explicit list also
//     means the env var is ignored entirely.
//
// Instrumentations are the same three the Azure path effectively runs, with bare
// defaults: `instrumentation-http` captures no headers and no bodies (never opt
// into `headersToSpanAttributes`), `instrumentation-pg` never captures bound
// parameter values (`enhancedDatabaseReporting` stays false), and
// `instrumentation-runtime-node` adds event-loop and V8 heap metrics. Node's
// global `fetch` (undici) is covered by Next's own fetch span, not by
// instrumentation-http. Novedu installs no diag logger; OTEL_LOG_LEVEL turns on
// the SDK's console diagnostics. No shutdown or flush handling exists — Next's
// standalone server owns process signals; the final batch may be lost on exit.
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { RuntimeNodeInstrumentation } from "@opentelemetry/instrumentation-runtime-node";
import { NodeSDK, type NodeSDKConfiguration, resources } from "@opentelemetry/sdk-node";
import type { TelemetryEnv } from "@/lib/telemetry-mode";

export const DEFAULT_SERVICE_NAME = "novedu-chat";

/** The fixed detector set — never `processDetector`, never "all". */
export const OTLP_RESOURCE_DETECTORS: resources.ResourceDetector[] = [
  resources.envDetector,
  resources.hostDetector,
  resources.osDetector,
  resources.serviceInstanceIdDetector,
];

/** Fresh instances with bare defaults (see the header for what that means). */
export function otlpInstrumentations() {
  return [new HttpInstrumentation(), new PgInstrumentation(), new RuntimeNodeInstrumentation()];
}

/** The complete NodeSDK configuration; exported so tests can pin its shape. */
export function otlpSdkConfiguration(
  env: TelemetryEnv = process.env,
): Partial<NodeSDKConfiguration> {
  const configuration: Partial<NodeSDKConfiguration> = {
    instrumentations: otlpInstrumentations(),
    resourceDetectors: OTLP_RESOURCE_DETECTORS,
  };
  if (!env.OTEL_SERVICE_NAME?.trim()) configuration.serviceName = DEFAULT_SERVICE_NAME;
  return configuration;
}

/**
 * Construct and start the SDK. Returns the instance for tests only (they call
 * `shutdown()` to flush their in-process receiver); the facade never does.
 */
export function startOtlpSdk(): NodeSDK {
  const sdk = new NodeSDK(otlpSdkConfiguration());
  sdk.start();
  return sdk;
}
