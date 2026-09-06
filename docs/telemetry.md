# Telemetry — Azure Monitor / Application Insights via OpenTelemetry

Deep reference for the app's optional observability. The always-on invariants are
summarized in `AGENTS.md`; this file has the full mechanics. Read it before
touching `instrumentation.ts`, `lib/telemetry.ts`, the `@opentelemetry/*` /
`@azure/monitor-opentelemetry` dependencies, or any call site that records an
event or an error.

## What it is, and that it is OFF by default

Server-side traces, metrics, logs and exceptions are exported to **Azure Monitor
(Application Insights)** through the **`@azure/monitor-opentelemetry`** OpenTelemetry
distro. The whole subsystem is gated on a single env var:

- **`APPLICATIONINSIGHTS_CONNECTION_STRING`** — **unset ⇒ telemetry is fully OFF**
  (no exporter, no network sink, no SDK brought up). `initTelemetry()` warns and
  returns `false`.
- **`OTEL_SERVICE_NAME`** (e.g. `novedu-chat`) — sets the App Insights
  `cloud_RoleName` so the app's spans are attributable.

The connection string is a **secret**: it lives in the local `.env` (gitignored)
and as an app-setting on the production web app — **never in the repo or CI**, so
the secret-free `qa.yml` invariant (`docs/ci-security.md`) holds. CI runs with it
unset, i.e. telemetry off.

## The seam: `lib/telemetry.ts`

All telemetry goes through one small module, so the rest of the app never imports
the heavy distro directly:

- **`initTelemetry()`** — one-time SDK bring-up. Dynamically imports the distro
  (keeps it out of edge/browser bundles) and calls `useAzureMonitor()` once. No-op
  / returns `false` when the connection string is unset.
- **`recordError(error, attrs?)`** — records a caught error as an AppExceptions
  entry. Safe when telemetry is off.
- **`emitEvent(name, attrs?)`** — a **content-free** custom-event helper (App
  Insights `customEvents` via the `microsoft.custom_event.name` convention). It
  goes through the OpenTelemetry logs API, which is a **no-op when no provider is
  registered** — so this module is safe to import from shared code and from the
  CLI (which must never emit telemetry); without `initTelemetry()` it does nothing
  and never touches the network.

## Startup ordering (`instrumentation.ts`)

`register()` runs once per server instance (Node runtime only) and does, in order:

1. **`initTelemetry()` FIRST** — before anything opens a connection — so the
   distro's auto-instrumentation can patch the HTTP and `pg` modules. Then
   `emitEvent("app_started", …)`.
2. Apply Drizzle migrations (see `docs/database.md`).

Telemetry is **independent of the database**: it is gated on
`APPLICATIONINSIGHTS_CONNECTION_STRING`, not `DATABASE_URL`, so the no-DB boot
path (e.g. plain `next build`, tutor validation) still initializes telemetry
if its own connection string is set.

## Capturing uncaught errors: `onRequestError`

`instrumentation.ts` also exports **`onRequestError`** (Next's hook, fired for
every uncaught error in route handlers, server actions, and RSC renders) → it
calls `recordError(err, { path, routeType })`. This is the capture path for errors
the distro's auto-instrumentation misses, **notably async DB-driver rejections**.

Two non-obvious, load-bearing details (both baked into `lib/telemetry.ts`):

- Once `onRequestError` is defined, **Next stops auto-recording exceptions on the
  request span** (it delegates to the hook) — so the hook must do the recording.
- `recordError()` records on a span created with **`{ root: true }`**. This is
  load-bearing: a child of the active request span would inherit that span's
  sampling decision, and an errored route's request span is *dropped*, so the
  exception would silently vanish. A fresh root span gets its own sampling
  decision, so every recorded error exports.

Errors that are caught and swallowed (e.g. a `console.error` in a `lib/*-store.ts`
that does not rethrow) never reach `onRequestError` — call `recordError()`
explicitly at those sites if you want them in AppExceptions.

## PRIVACY INVARIANT — no message/prompt/PII content

**Telemetry must never carry conversation, prompt, or PII content.** HTTP bodies
are not captured by the auto-instrumentation (request/dependency spans record URLs
and timings only). The **one seam where content could leak is `emitEvent()`** — so
pass it only metadata: identifiers, names, counts, booleans. Never a message, a
prompt, or user-entered text. `recordError()` records the error's own message/stack
(keep thrown errors free of user content for the same reason).

> Note: a tutor code can appear in `AppRequests.Url` (it is an access credential in
> the path). Redaction of that is an open follow-up.

## Operating it

- **Querying:** the App Insights component is **workspace-based**
  (`novedu-chat-mvp-ai`, backed by the `novedu-chat-mvp-logs` Log Analytics
  workspace, RG `Novedu-Chat-MVP`, region `austriaeast`). Query it through the
  **Log Analytics workspace using the `App*` table names** (`AppRequests`,
  `AppDependencies`, `AppExceptions`, `AppEvents`, …). The classic component query
  API (`az monitor app-insights query --app novedu-chat-mvp-ai`, lowercase
  `requests`/`dependencies`/`exceptions`/`customEvents`) reads the same data.
- **Dependencies:** `@azure/monitor-opentelemetry`, `@opentelemetry/api`,
  `@opentelemetry/api-logs` (`api-logs` is pinned to match the distro's global
  logger). The distro is listed in `serverExternalPackages` so it is not bundled.

## `pg` dependency calls

The Azure Monitor distro auto-instruments the `pg` driver, so every database
round trip (Drizzle queries and Mastra's storage calls alike, since both share
the one pool from `lib/db/pool.ts`) is an `AppDependencies` row of type
`postgresql` with target `db-pgnovedu.postgres.database.azure.com|novedu`; the
`name` carries the statement's verb (`pg.query:SELECT novedu`) and `data` the
statement text with `$1`-style placeholders, never the bound values. A failed
statement is the same row with `success == false` plus an `AppExceptions` row
whose message names the SQLSTATE (`PostgreSQL error … (code: 42501)`) — the
first place to look when a boot logs a privilege problem (`docs/database.md`,
ownership hazard).
