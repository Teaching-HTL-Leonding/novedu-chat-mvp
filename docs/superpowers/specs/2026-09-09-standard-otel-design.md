# Standard OpenTelemetry export with Aspire

## Purpose and decision

This specification defines an optional standard OpenTelemetry initialization
path alongside the Azure Monitor initialization path. The application selects
one path per server process. Aspire's standalone dashboard is the reference
backend for local development and diagnostic sessions outside Azure.

The selected approach preserves `@azure/monitor-opentelemetry` and its Azure
configuration. The alternative of replacing that distribution with a common
SDK and individual Azure exporters requires reconstructing Azure-specific
instrumentation and is outside this scope.

The standard path sends OTLP directly to the configured receiver. Aspire runs
in one container; a separate OpenTelemetry Collector and an Aspire AppHost are
not required. Any compatible OTLP receiver can replace Aspire through
configuration. This specification concerns telemetry only; it does not define
changes to application authentication, database access, LLMs, or storage.

## Configuration contract

Selection happens once at Node server startup, in this order:

| Condition | Result |
| --- | --- |
| `OTEL_SDK_DISABLED=true` | Telemetry disabled, regardless of other settings. |
| Non-empty `OTEL_EXPORTER_OTLP_ENDPOINT` | Standard OTEL path; no Azure initialization. |
| Non-empty `APPLICATIONINSIGHTS_CONNECTION_STRING` | Azure Monitor path. |
| Neither destination is configured | Telemetry disabled; no SDK or exporter starts. |

Whitespace-only destination values count as absent. The disable flag follows
the SDK's case-insensitive boolean convention. OTLP takes precedence when both
destinations are present, allowing local configuration to select Aspire without
removing the Azure setting. A safe startup message identifies only the selected
mode, without printing endpoints, connection strings, or credentials.

`OTEL_EXPORTER_OTLP_ENDPOINT` is the explicit opt-in for the standard path.
Per-signal endpoint variables alone do not enable telemetry. Once enabled,
standard SDK settings configure service identity, export protocol, headers,
per-signal overrides, timeouts, sampling, and export intervals. In particular:

- `OTEL_SERVICE_NAME` identifies the application; the standard path defaults to
  `novedu-chat` when it is absent.
- `OTEL_EXPORTER_OTLP_PROTOCOL` defaults to `http/protobuf`. The standard path
  supports the SDK's OTLP transports: HTTP/protobuf, HTTP/JSON, and gRPC.
- Global endpoint, headers, protocol, and timeout settings may be overridden
  per signal using their standard OTEL variables and precedence.
- HTTP base endpoints use the SDK's signal-path construction. Explicit
  per-signal HTTP endpoints include their complete `/v1/traces`, `/v1/logs`, or
  `/v1/metrics` path.
- The trace, log, and metric exporter selections support `otlp` and `none`.
  Export to multiple destinations or other exporter types is outside scope.
- Metric collection uses a periodic reader. The local example sets
  `OTEL_METRIC_EXPORT_INTERVAL=5000` for useful feedback during debugging.

Invalid standard-path configuration disables that path with a sanitized
diagnostic. It never falls back to Azure or silently substitutes a destination.
Environment changes take effect after restarting the app process.

## Components and startup

`lib/telemetry.ts` remains the application interface for `initTelemetry()`,
`emitEvent()`, and `recordError()`. Backend configuration and initialization live
in focused, dynamically imported modules. Callers do not select backends or
import SDK implementations.

The configuration resolver selects disabled, Azure, or OTLP mode without
initializing an SDK. The Azure initializer calls `useAzureMonitor()` with the
connection string. The OTLP initializer uses the standard Node SDK, with trace,
log, and metric providers/exporters and explicitly selected instrumentation.
Exactly one initializer runs. Concurrent initialization calls share one attempt
and cannot register duplicate providers, instrumentation, timers, or handlers.

`instrumentation.ts` awaits initialization in its Node-only `register()` branch,
before database modules load or connections open. Startup does not wait for the
remote telemetry receiver to become available. The edge/browser branches do
not initialize telemetry. The `app_started` event and Next's `onRequestError`
hook continue through the shared interface.

The Azure distribution is loaded only for Azure mode. Standard-mode resource
detection does not probe Azure metadata services. Use an explicit set of
resource attributes/detectors that avoids collecting command-line arguments,
environment contents, usernames, or other unintended personal information.
Configured resource attributes remain subject to the content-free contract.

Direct SDK dependencies must be declared rather than borrowed from the Azure
distribution's transitive dependencies. Their versions must interoperate with
the shared OTEL APIs. Runtime packages that rely on Node module loading remain
external to Next's bundle and are included in the standalone Docker output.

## Signals and privacy

The standard path provides:

- Next request spans, HTTP dependencies, and PostgreSQL dependency spans.
- Exceptions recorded by `recordError()`, including Next request errors.
- Application events emitted through the OTEL logs API.
- Node runtime metrics, including memory and event-loop measurements.

Register only the instrumentation needed for this coverage. PostgreSQL
instrumentation must not capture bound parameter values. HTTP instrumentation
must not capture request/response bodies, cookies, or authorization headers.
Avoid duplicate request spans caused by overlapping instrumentation.

`emitEvent()` keeps the event name in the log body so Aspire can display it.
Retain the `microsoft.custom_event.name` attribute for Azure custom-event
mapping; an ordinary OTLP receiver may treat it as an additional attribute.
Application event attributes contain metadata only, never prompts, conversation
content, or user-entered text.

`recordError()` retains its dedicated root span and exception event semantics.
It must not inherit an active request span's dropped sampling decision.
Export remains subject to the selected root sampler, bounded queues, and
receiver availability; recording does not guarantee delivery. Error messages
and stacks must remain free of user content.

The baseline is useful signal coverage, not identical Azure and Aspire metric
names, tables, dashboards, or Azure-specific diagnostics. Full prompt/agent
tracing and automatic capture of arbitrary console output are outside scope.
The URL/code redaction limitation documented in `docs/telemetry.md` remains an
explicit constraint; this exporter change must not broaden captured content.

## Failure and lifecycle behavior

Telemetry is best effort. An unavailable receiver, export timeout, queue
overflow, or SDK initialization failure must not prevent startup, database
migrations, or request handling. Export uses bounded SDK batching, queues,
timeouts, and retries. Diagnostics never include exported payloads or secrets.

An initialization failure returns `false`, reports a sanitized diagnostic, and
cleans up partially initialized SDK state where possible. The process does not
attempt a different destination. Backend recovery is handled by later export
attempts; configuration or initialization failures require an app restart.

Shutdown offers a best-effort flush with a maximum five-second wait and releases SDK resources. It
must cooperate with Next's existing shutdown handling, must not install a
competing `process.exit()` path, and must not leave a stopped server alive due
to telemetry timers. Verify this against the actual standalone server.

Importing the telemetry facade or calling event/error helpers without
initialization remains inert. The CLI never calls initialization and must not
create exporters or send telemetry, even when OTEL or Azure variables exist
in its environment. Disabled server mode likewise brings up no SDK.

## Aspire local setup

Provide `compose.telemetry.yaml` containing only the standalone Aspire
dashboard service, with a pinned image tag. Use the dashboard's default browser
token authentication and document retrieving its login URL from container logs.
Publish the UI and OTLP/HTTP port on loopback for local host access.

| Consumer | Destination |
| --- | --- |
| Browser on host | `http://localhost:18888` |
| App running on host | `http://localhost:4318` |
| App container on the same Compose network | `http://aspire:18890` |

The Compose service maps host port `4318` to Aspire's container port `18890`.
Container instructions explicitly describe joining the same network; localhost
inside an app container does not refer to Aspire. HTTP/protobuf is the documented
local transport, so the example needs no published gRPC port.

Aspire stores telemetry in memory and discards it on restart. This setup is for
development and short-term diagnostics. Durable storage and production hosting
of a non-Azure telemetry backend are outside scope.

## Verification and documentation

Use secret-free tests with synthetic telemetry:

1. Exercise destination selection, both-settings precedence, explicit disable,
   invalid settings, and concurrent/repeated initialization. Verify only the
   chosen SDK initializes and disabled mode creates no exporter.
2. Use the real OTEL SDK and a loopback OTLP receiver in isolated processes to
   verify decoded trace, exception, log-event, and runtime-metric payloads.
   Check service identity, signal paths, supported protocols, header overrides,
   and representative privacy assertions. SDK globals must not leak between
   test cases.
3. Verify receiver failure does not reject initialization or application work,
   queues remain bounded, and shutdown finishes within its bound. Exercise CLI
   imports/commands with telemetry environment variables present and assert no
   telemetry requests occur.
4. Verify Azure initializer wiring with a mocked Azure boundary. Keep real
   Azure credentials and ingestion out of the hermetic suite.
5. Build the Next standalone image and smoke-test it with Aspire: request
   traces, a synthetic event, an exception, and runtime metrics are visible;
   stopping Aspire leaves the app responsive; stopping the app terminates it.
   Any authenticated app smoke uses synthetic local fixtures. No real student
   content is used to test telemetry.

Run the relevant lint, type, unit, CLI, and build checks for the resulting code
changes. Tests that only need a loopback receiver do not need a real Azure
service or an `@live` tag.

Keep `docs/telemetry.md`, the telemetry entries in `AGENTS.md`, and README
environment/setup instructions aligned with the implemented configuration.
These operational documents describe current behavior only. Inspect the CLI's
bundled dependency closure: changes within it require the release preparation
specified by `docs/cli-publish.md`. Publishing and GitHub pushes remain subject
to the user's explicit authorization.

## References

- [OpenTelemetry JavaScript exporters](https://opentelemetry.io/docs/languages/js/exporters/)
- [OTLP exporter configuration](https://opentelemetry.io/docs/languages/sdk-configuration/otlp-exporter/)
- [Aspire standalone dashboard](https://aspire.dev/dashboard/standalone/)
- Installed Next guides: `node_modules/next/dist/docs/01-app/02-guides/open-telemetry.md`
  and `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md`.
- Repository contracts: `docs/telemetry.md`, `docs/testing.md`, and `docs/cli-publish.md`.
