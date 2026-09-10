// Telemetry backend selection — a pure resolver with no imports, so it is
// unit-testable without loading an SDK and safe to evaluate before anything
// else at server startup.
//
// Exactly one backend runs per process. The order is fixed (docs/telemetry.md):
//
//   1. OTEL_SDK_DISABLED=true            → disabled, whatever else is set
//   2. OTEL_EXPORTER_OTLP_ENDPOINT set   → standard OTLP export (NodeSDK)
//   3. APPLICATIONINSIGHTS_CONNECTION_STRING set → Azure Monitor
//   4. neither destination               → disabled; no SDK, no exporter
//
// OTLP wins when both destinations are present so a local `.env` can point at
// Aspire without removing the Azure setting — the flip side being that setting
// the OTLP endpoint on the production Web App switches it off App Insights.
// Whitespace-only values count as absent; the disable flag follows the SDK's
// case-insensitive boolean convention. Reasons name variables, never values.

export type TelemetryMode = "disabled" | "azure" | "otlp";

export type TelemetryChoice = { mode: TelemetryMode; reason: string };

function present(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function resolveTelemetryMode(env: NodeJS.ProcessEnv = process.env): TelemetryChoice {
  if (env.OTEL_SDK_DISABLED?.trim().toLowerCase() === "true") {
    return { mode: "disabled", reason: "OTEL_SDK_DISABLED=true" };
  }
  if (present(env.OTEL_EXPORTER_OTLP_ENDPOINT)) {
    return { mode: "otlp", reason: "OTEL_EXPORTER_OTLP_ENDPOINT is set" };
  }
  if (present(env.APPLICATIONINSIGHTS_CONNECTION_STRING)) {
    return { mode: "azure", reason: "APPLICATIONINSIGHTS_CONNECTION_STRING is set" };
  }
  return {
    mode: "disabled",
    reason: "neither OTEL_EXPORTER_OTLP_ENDPOINT nor APPLICATIONINSIGHTS_CONNECTION_STRING is set",
  };
}
