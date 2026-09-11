// Telemetry seam — the ONE application interface over OpenTelemetry.
//
// Two responsibilities, deliberately split:
//   1. initTelemetry(): one-time SDK bring-up. A pure resolver
//      (lib/telemetry-mode.ts) picks disabled / Azure Monitor / standard OTLP
//      from the environment without loading an SDK; the chosen initializer
//      (lib/telemetry-azure.ts or lib/telemetry-otlp.ts) is then dynamically
//      imported. Exactly one backend runs per process; callers never choose one
//      and never import an SDK. Called once from instrumentation.ts, in the
//      Node-only branch.
//   2. emitEvent() / recordError(): thin, content-free helpers for feature
//      usage and caught errors.
//
// WHY THIS SHAPE:
//   - emitEvent() goes through the OpenTelemetry logs API and recordError()
//     through the trace API; both are NO-OPs when no provider is registered. So
//     this module is safe to import from shared code: without initTelemetry()
//     (a process with no destination configured) they do nothing and never
//     touch the network. The CLI never initializes telemetry and must never
//     import this module (grep-guarded in lib/telemetry-isolation.unit.test.ts).
//   - The initializers are loaded with DYNAMIC imports so neither SDK enters
//     edge/browser bundles and only the selected one is paid for on the server.
//   - Bring-up is idempotent and cached, including its failure: a backend that
//     fails to start leaves telemetry off for the life of the process and never
//     falls back to the other one. Startup logs name only the selected mode —
//     never an endpoint, connection string, or credential.
//   - PRIVACY: only pass metadata to emitEvent()/recordError() — never
//     message/prompt/PII content. Bodies and headers are not captured by HTTP
//     auto-instrumentation and bound SQL values are not captured by the pg one;
//     these helpers are the one seam where content could leak, so keep them to
//     identifiers and counts.
import { SpanStatusCode, trace } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { resolveTelemetryMode, type TelemetryMode } from "@/lib/telemetry-mode";

export type { TelemetryMode };

let bringUp: Promise<TelemetryMode> | null = null;

/**
 * Bring up the selected backend exactly once and report which one runs.
 * Concurrent and repeated calls share the first outcome — including
 * "disabled" after a failed start. Never throws.
 */
export function initTelemetry(): Promise<TelemetryMode> {
  bringUp ??= start();
  return bringUp;
}

async function start(): Promise<TelemetryMode> {
  const { mode, reason } = resolveTelemetryMode();
  if (mode === "disabled") {
    console.warn(`telemetry: disabled (${reason})`);
    return "disabled";
  }
  try {
    if (mode === "azure") {
      const { startAzureMonitor } = await import("@/lib/telemetry-azure");
      startAzureMonitor((process.env.APPLICATIONINSIGHTS_CONNECTION_STRING ?? "").trim());
    } else {
      const { startOtlpSdk } = await import("@/lib/telemetry-otlp");
      startOtlpSdk();
    }
    console.log(`telemetry: mode=${mode}`);
    return mode;
  } catch (error) {
    console.error(
      `telemetry: ${mode} initialization failed — telemetry stays off until restart:`,
      describeFailure(error),
    );
    return "disabled";
  }
}

/** Error name + message with every configured destination value redacted. */
function describeFailure(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return [
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    process.env.APPLICATIONINSIGHTS_CONNECTION_STRING,
  ].reduce<string>(
    (acc, secret) => (secret?.trim() ? acc.split(secret.trim()).join("[redacted]") : acc),
    text,
  );
}

type EventAttributes = Record<string, string | number | boolean>;

/**
 * Record a caught error as an exception (App Insights `AppExceptions`; an
 * `exception` span with an exception event on any other receiver).
 *
 * WHY THIS EXISTS: auto-instrumentation only captures SOME unhandled errors
 * (e.g. a synchronous throw in a route handler, which Next records on the
 * request span). Async driver rejections (a failed SQL statement) and any
 * caught-and-logged error do NOT surface on their own. Call this at the failure
 * site to guarantee the error reaches OTEL. Safe when telemetry is off (no
 * provider → no-op).
 */
export function recordError(error: unknown, attributes?: EventAttributes): void {
  const err = error instanceof Error ? error : new Error(String(error));

  // Record on a dedicated ROOT span. `root: true` is load-bearing: if this span
  // inherited the active request span as parent, it would also inherit that
  // span's sampling decision — and an errored route's request span is dropped,
  // so the exception would silently vanish (observed for sync route throws via
  // onRequestError; async DB errors survived only because their request span had
  // already ended, making this a root span by accident). Forcing root gives the
  // exception an independent root sampling decision. Delivery is still subject
  // to the sampler, the bounded batch queues and receiver availability. End
  // immediately so it always reaches the processor.
  const span = trace.getTracer("novedu-app").startSpan("exception", { root: true });
  if (attributes) span.setAttributes(attributes);
  span.recordException(err);
  span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
  span.end();
}

/**
 * Record a content-free feature-usage event. The event name travels three ways
 * at once: as the log body (so a plain receiver such as Aspire displays it), as
 * the record's first-class `eventName`, and as the `microsoft.custom_event.name`
 * attribute that lands it in the App Insights `customEvents` table (an ordinary
 * receiver shows that as one more attribute). Safe to call when telemetry is
 * off — the logs API is a no-op without a registered provider.
 */
export function emitEvent(name: string, attributes?: EventAttributes): void {
  logs.getLogger("novedu-app").emit({
    body: name,
    eventName: name,
    attributes: { "microsoft.custom_event.name": name, ...attributes },
  });
}
