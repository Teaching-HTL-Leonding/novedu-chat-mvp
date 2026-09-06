// Telemetry seam — Azure Monitor (Application Insights) via OpenTelemetry.
//
// Two responsibilities, deliberately split:
//   1. initTelemetry(): one-time SDK bring-up. Loads the heavy
//      `@azure/monitor-opentelemetry` distro (auto-instruments HTTP + the
//      `pg` driver, captures exceptions, exports traces/metrics/logs).
//      Gated on APPLICATIONINSIGHTS_CONNECTION_STRING — unset means telemetry is
//      fully OFF (no exporter, no network sink). Called once from
//      instrumentation.ts, in the Node-only branch.
//   2. emitEvent(): a thin, content-free custom-event helper for feature usage.
//
// WHY THIS SHAPE:
//   - emitEvent() goes through the OpenTelemetry logs API, which is a NO-OP when
//     no LoggerProvider is registered. So this module is safe to import from
//     shared code: without initTelemetry() (e.g. in the CLI, or any process
//     without the connection string) emitEvent() does nothing and never touches
//     the network. The CLI prints to the console; it must never log telemetry.
//   - The distro is loaded with a DYNAMIC import inside initTelemetry() so it
//     never enters edge/browser bundles and is only paid for on the server.
//   - PRIVACY: only pass metadata to emitEvent() — never message/prompt/PII
//     content. Bodies are not captured by HTTP auto-instrumentation; this is the
//     one seam where content could leak, so keep it to identifiers and counts.
import { SpanStatusCode, trace } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";

let initialized = false;

/**
 * Bring up Azure Monitor exactly once. Returns true if telemetry is active.
 * No-op (returns false) when APPLICATIONINSIGHTS_CONNECTION_STRING is unset.
 */
export async function initTelemetry(): Promise<boolean> {
  if (initialized) return true;

  const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
  if (!connectionString) {
    console.warn("telemetry: APPLICATIONINSIGHTS_CONNECTION_STRING not set — telemetry disabled");
    return false;
  }

  // Dynamic import keeps the distro out of edge/browser bundles and off the
  // import graph of anything that merely wants emitEvent(). Aliased on
  // destructuring: the `use*` name reads as a React hook to Biome's lint, but
  // this is a plain SDK bring-up call.
  const { useAzureMonitor: enableAzureMonitor } = await import("@azure/monitor-opentelemetry");
  enableAzureMonitor({
    azureMonitorExporterOptions: { connectionString },
  });

  initialized = true;
  return true;
}

type EventAttributes = Record<string, string | number | boolean>;

/**
 * Record a caught error as an exception in App Insights (AppExceptions).
 *
 * WHY THIS EXISTS: auto-instrumentation only captures SOME unhandled errors
 * (e.g. a synchronous throw in a route handler, which Next records on the
 * request span). Async driver rejections (a failed SQL statement) and any
 * caught-and-logged error do NOT surface on their own. Call this at the failure
 * site to guarantee the error reaches OTEL. Safe when telemetry is off (no
 * active span / no provider → no-op).
 *
 * Attaches to the active span (the request span inside a handler) so it exports
 * reliably; falls back to a short-lived span when there is none.
 */
export function recordError(error: unknown, attributes?: EventAttributes): void {
  const err = error instanceof Error ? error : new Error(String(error));

  // Record on a dedicated ROOT span. `root: true` is load-bearing: if this span
  // inherited the active request span as parent, it would also inherit that
  // span's sampling decision — and an errored route's request span is dropped,
  // so the exception would silently vanish (observed for sync route throws via
  // onRequestError; async DB errors survived only because their request span had
  // already ended, making this a root span by accident). Forcing root gives a
  // fresh sampling decision so every recorded error exports. End immediately so
  // it always flushes.
  const span = trace.getTracer("novedu-app").startSpan("exception", { root: true });
  if (attributes) span.setAttributes(attributes);
  span.recordException(err);
  span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
  span.end();
}

/**
 * Record a content-free feature-usage event. Lands in the App Insights
 * `customEvents` table via the `microsoft.custom_event.name` convention.
 * Safe to call when telemetry is off — the logs API is a no-op without a
 * registered provider.
 */
export function emitEvent(name: string, attributes?: EventAttributes): void {
  logs.getLogger("novedu-app").emit({
    body: name,
    attributes: { "microsoft.custom_event.name": name, ...attributes },
  });
}
