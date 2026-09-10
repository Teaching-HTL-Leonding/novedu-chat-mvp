// Azure Monitor (Application Insights) backend — the `@azure/monitor-opentelemetry`
// distro. Loaded ONLY through the dynamic import in lib/telemetry.ts when the
// resolver picked "azure", so the static import below never enters an edge or
// browser bundle and is never paid for on the OTLP path.
//
// The distro builds its own NodeSDK (HTTP + `pg` auto-instrumentation with bare
// defaults, exceptions, traces/metrics/logs export, Azure resource detection,
// the App Insights sampler, custom-event mapping) and enables Live Metrics by
// default — kept on deliberately. Nothing but the connection string is passed.
// Aliased on import: the `use*` name reads as a React hook to Biome's lint, but
// this is a plain SDK bring-up call.
import { useAzureMonitor as enableAzureMonitor } from "@azure/monitor-opentelemetry";

export function startAzureMonitor(connectionString: string): void {
  enableAzureMonitor({
    azureMonitorExporterOptions: { connectionString },
  });
}
